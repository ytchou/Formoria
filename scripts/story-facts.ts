/**
 * Read-only fact sheet for the zh-TW article-drafting skill.
 *
 * The drafting step is only allowed to assert what appears here, and every fact
 * carries a provenance marker naming where it came from. That constraint is not
 * stylistic: a wrong booth number or a wrong date in a published article is a
 * credibility problem, and 公平交易委員會 rules bite on unsupported quality
 * claims. A fact with no `source` is a fact the drafter invented.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/story-facts.ts --event 2026-taiwan-creative-expo
 *   pnpm exec tsx --env-file=.env.local scripts/story-facts.ts --brands woky,filter017 --out facts.json
 *   pnpm exec tsx --env-file=.env.local scripts/story-facts.ts --event 2026-taiwan-creative-expo --brands woky --out facts.json
 *
 * Or via the package script: `pnpm story:facts --event <slug>`.
 *
 * READ-ONLY, absolutely. This script issues SELECTs and nothing else. It must
 * never reach for `runEnrich` or `runReputationResearch`: those mutate brand
 * rows and are only legal inside a real curation job
 * (request_brand_refresh -> job -> apply_brand_refresh). A fact sheet that
 * rewrites the brands it is describing would also invalidate its own output.
 *
 * `--event` and `--brands` UNION rather than intersect. Intersecting would
 * silently drop a slug the caller explicitly asked for, and a fact sheet that
 * quietly omits a brand is worse than one carrying a brand the article ends up
 * not mentioning — the drafter can ignore a spare entry, but it cannot notice
 * an entry that was never emitted. Event-only facts (booth, area) are simply
 * absent for brands that are not in the event file.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createServiceClient } from "@/lib/supabase/service";
import { getBrandsBySlugs } from "@/lib/services/brands";
import { applyPublicStockistVisibility } from "@/lib/brands/stockist-display";
import type { Brand } from "@/lib/types";

/**
 * PostgREST sends `.in()` filters in the GET query string, so a few hundred ids
 * in one call overrun the request line and come back as a bare 400. 200 matches
 * the chunk size already used by `services/brands.ts` and `services/submissions.ts`.
 */
const IN_FILTER_CHUNK_SIZE = 200;

/** A single asserted fact plus the provenance marker the drafter must cite. */
type Fact<T> = { value: T; source: string };

/**
 * Only the keys this script reads. The file has more (localized `_en` variants
 * of most prose fields), and it is versioned, so a field that is absent today
 * may appear later — every read below tolerates `undefined` rather than
 * asserting the shape.
 *
 * Keys are camelCase in the file, NOT snake_case like the columns they seed.
 */
type EventFile = {
  slug?: string;
  brands?: Array<{
    slug?: string;
    booth?: string | null;
    area?: string | null;
    areaEn?: string | null;
    sortOrder?: number | null;
  }>;
  [key: string]: unknown;
};

/**
 * Event fields lifted verbatim from the checked-in JSON, in the order a draft
 * usually needs them. Scalars only: anything requiring interpretation (the
 * `brands` array) is handled separately.
 *
 * The checked-in file beats the `events` table on purpose. Both hold the same
 * data, but the file is the reviewed source of truth — it is versioned, a diff
 * on it is readable in a PR, and `scripts/seed-events.ts` pushes it INTO the
 * database rather than the other way round. Reading the table would report
 * whatever the last seed run happened to leave there, including a stale row
 * from before an unmerged correction.
 */
const EVENT_FACT_KEYS = [
  "name",
  "nameEn",
  "summary",
  "summaryEn",
  "description",
  "descriptionEn",
  "startsOn",
  "endsOn",
  "venueName",
  "venueNameEn",
  "venueAddress",
  "city",
  "organizerName",
  "officialUrl",
  "ticketUrl",
  "isFree",
  "status",
  "scheduleNote",
  "scheduleNoteEn",
  "admissionNote",
  "admissionNoteEn",
  "travelNote",
  "travelNoteEn",
  "lineupNote",
  "lineupNoteEn",
  "heroImageUrl",
] as const;

/**
 * Columns read from `brand_faq_entries`. That table is row-per-answer, keyed
 * `(brand_id, preset_id, position)` — not a wide table with one column per
 * question. `preset_id` is an open vocabulary owned by `FAQ_PRESETS`
 * (`src/lib/brands/faq-presets/`), so this reader never enumerates presets: a
 * preset added there must show up in a fact sheet without a change here.
 *
 * `source` travels with every entry because it is provenance in the strict
 * sense the drafting skill needs — `human` is a brand owner's or admin's own
 * words, `model` is generated text that a story must not quote as if the brand
 * had said it.
 */
const FAQ_ENTRY_COLUMNS =
  "brand_id, preset_id, position, question_zh, answer_zh, question_en, answer_en, source";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * A fact is worth emitting only if it carries content. Empty strings and empty
 * arrays are the DB's way of saying "not filled in", and passing them through
 * as facts would let the drafter write a sentence around nothing — they belong
 * in `missing`, which becomes a 待確認 marker in the draft.
 */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Collects facts and, for anything absent, the field name the drafter must flag. */
class FactCollector {
  readonly facts: Record<string, Fact<unknown>> = {};
  readonly missing: string[] = [];

  add(field: string, value: unknown, source: string): void {
    if (isPresent(value)) {
      this.facts[field] = { value, source };
    } else {
      this.missing.push(field);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Run with --env-file=.env.local (see the header comment).`,
    );
  }
  return value;
}

async function loadEventFile(
  slug: string,
): Promise<{ path: string; data: EventFile }> {
  // Relative to the repo root, which is where pnpm/tsx runs scripts from.
  const path = `content/events/${slug}.json`;
  let raw: string;
  try {
    raw = await readFile(resolve(process.cwd(), path), "utf8");
  } catch {
    throw new Error(
      `No event file at ${path}. Check the slug against \`ls content/events\`.`,
    );
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return { path, data: parsed as EventFile };
}

/**
 * The lineup entry per slug, keyed for O(1) lookup while building brand facts.
 * The array index is kept because it is part of the provenance marker: a
 * reviewer checking `brands[3].booth` needs the position, not just the field.
 */
function indexEventLineup(
  data: EventFile,
): Map<
  string,
  { entry: NonNullable<EventFile["brands"]>[number]; index: number }
> {
  const byslug = new Map<
    string,
    { entry: NonNullable<EventFile["brands"]>[number]; index: number }
  >();
  const entries = data.brands ?? [];
  entries.forEach((entry, index) => {
    if (typeof entry?.slug === "string" && entry.slug.length > 0) {
      byslug.set(entry.slug, { entry, index });
    }
  });
  return byslug;
}

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * `getBrandsBySlugs` runs the directory projection, which deliberately omits
 * four large jsonb columns (`DIRECTORY_OMITTED_COLUMNS`) — among them
 * `site_content`, whose tagline/story/products are some of the best-sourced
 * prose a brand owns. So the domain objects are topped up here with one extra
 * batched read rather than being fetched a second time in full.
 */
async function fetchSiteContent(
  supabase: SupabaseClient,
  brandIds: string[],
): Promise<Map<string, unknown>> {
  const byBrandId = new Map<string, unknown>();
  for (const ids of chunk(brandIds, IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("brands")
      .select("id, site_content")
      .in("id", ids);
    if (error)
      throw new Error(`brands site_content read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{
      id: string;
      site_content: unknown;
    }>) {
      byBrandId.set(row.id, row.site_content);
    }
  }
  return byBrandId;
}

type FaqEntryRow = {
  brand_id: string;
  preset_id: string;
  position: number | null;
  question_zh: string | null;
  answer_zh: string | null;
  question_en: string | null;
  answer_en: string | null;
  source: string;
};

/**
 * Every stored FAQ entry, grouped by brand and ordered the way the brand page
 * resolves them (preset, then position) — see `getBrandFaqEntries` in
 * `src/lib/services/brand-faq.ts`, whose ordering this mirrors so a fact sheet
 * and the live page never disagree about which answer comes first.
 *
 * A missing table is NOT swallowed. An earlier revision of this reader queried
 * `brand_faq`, which does not exist, and treated the resulting `PGRST205` as a
 * benign warning — so every FAQ fact was reported `missing` and the draft went
 * out with `[待確認]` markers over questions the brand had already answered. A
 * schema that has moved is a bug in this script, and it should stop the run.
 */
async function fetchFaqRows(
  supabase: SupabaseClient,
  brandIds: string[],
): Promise<{ rows: Map<string, FaqEntryRow[]>; warnings: string[] }> {
  const byBrandId = new Map<string, FaqEntryRow[]>();
  for (const ids of chunk(brandIds, IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("brand_faq_entries")
      .select(FAQ_ENTRY_COLUMNS)
      .in("brand_id", ids);
    if (error)
      throw new Error(`brand_faq_entries read failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as FaqEntryRow[]) {
      const existing = byBrandId.get(row.brand_id);
      if (existing) existing.push(row);
      else byBrandId.set(row.brand_id, [row]);
    }
  }
  for (const rows of byBrandId.values()) {
    rows.sort(
      (a, b) =>
        a.preset_id.localeCompare(b.preset_id) ||
        (a.position ?? 0) - (b.position ?? 0),
    );
  }
  return { rows: byBrandId, warnings: [] };
}

type StockistFact = {
  name: string;
  url: string | null;
  address: string | null;
  regionLabel: string | null;
};

/**
 * Raw batched read rather than `getStockistsForBrand`: that service is per-brand
 * (123 sequential round trips for one event) and returns rows already grouped
 * for display, which a script has no use for. Its visibility filters are what
 * matter and are reproduced exactly — a removed channel, an owner-rejected one,
 * or a community submission no admin has approved yet must never reach a draft,
 * because sending a reader to a stockist the brand has disowned (or that nobody
 * has checked at all) is precisely the kind of error this file exists to
 * prevent. All three are one shared call, `applyPublicStockistVisibility`, so
 * this script cannot drift away from the service again.
 */
async function fetchStockists(
  supabase: SupabaseClient,
  brandIds: string[],
): Promise<Map<string, StockistFact[]>> {
  const byBrandId = new Map<string, StockistFact[]>();
  for (const ids of chunk(brandIds, IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await applyPublicStockistVisibility(
      supabase
        .from("brand_channels")
        .select("brand_id, name, url, address, region_label")
        .in("brand_id", ids),
    );
    if (error) throw new Error(`brand_channels read failed: ${error.message}`);

    for (const row of (data ?? []) as Array<{
      brand_id: string;
      name: string;
      url: string | null;
      address: string | null;
      region_label: string | null;
    }>) {
      const existing = byBrandId.get(row.brand_id) ?? [];
      existing.push({
        name: row.name,
        url: row.url,
        address: row.address,
        regionLabel: row.region_label,
      });
      byBrandId.set(row.brand_id, existing);
    }
  }
  return byBrandId;
}

/**
 * Brand columns emitted verbatim, as `[domain field, source column]`.
 *
 * There is no `materials` column and no `founder` column. Those facts exist
 * only inside `description` prose, so they travel as prose under
 * `db:brands.description` and must never be promoted to an atomic field here —
 * an atomic `founder` invented by splitting a sentence is exactly the kind of
 * unsourced assertion the fact sheet is meant to make impossible.
 */
const BRAND_FACT_FIELDS = [
  ["name", "name"],
  ["description", "description"],
  ["descriptionEn", "description_en"],
  ["blurb", "blurb"],
  ["blurbEn", "blurb_en"],
  ["categorySlug", "category"],
  ["subcategories", "subcategories"],
  ["subcategoriesEn", "subcategories_en"],
  ["city", "city"],
  ["foundingYear", "founding_year"],
  ["purchaseWebsite", "purchase_website"],
  ["purchasePinkoi", "purchase_pinkoi"],
  ["purchaseShopee", "purchase_shopee"],
  ["socialInstagram", "social_instagram"],
  ["heroImageUrl", "hero_image_url"],
] as const satisfies ReadonlyArray<readonly [keyof Brand, string]>;

function collectBrandFacts(brand: Brand, collector: FactCollector): void {
  for (const [field, column] of BRAND_FACT_FIELDS) {
    collector.add(field, brand[field], `db:brands.${column}`);
  }
}

function collectSiteContentFacts(
  siteContent: unknown,
  collector: FactCollector,
): void {
  const content =
    typeof siteContent === "object" && siteContent !== null
      ? (siteContent as {
          tagline?: unknown;
          story?: unknown;
          products?: unknown;
        })
      : {};
  collector.add(
    "siteTagline",
    content.tagline,
    "db:brands.site_content.tagline",
  );
  collector.add("siteStory", content.story, "db:brands.site_content.story");
  collector.add(
    "siteProducts",
    content.products,
    "db:brands.site_content.products",
  );
}

/**
 * A stored FAQ answers in both languages; the draft is zh-TW, so a row missing
 * the zh pair is treated as absent rather than silently handing the drafter
 * English to translate — a translated claim has no provenance.
 */
function collectFaqFacts(
  rows: FaqEntryRow[] | undefined,
  collector: FactCollector,
): void {
  const renderable = (rows ?? []).filter(
    (row) => isPresent(row.question_zh) && isPresent(row.answer_zh),
  );

  // One `faq` fact, not one per preset. Presets are an open vocabulary, so a
  // fixed field per preset would go stale the moment one is added — and the
  // drafter wants the brand's answers as a set anyway, to pick the two or three
  // that bear on this story.
  collector.add(
    "faq",
    renderable.length > 0
      ? renderable.map((row) => ({
          presetId: row.preset_id,
          question: row.question_zh,
          answer: row.answer_zh,
          questionEn: row.question_en,
          answerEn: row.answer_en,
          // `human` may be quoted as the brand's own words; `model` is
          // generated text and must be treated as a lead to verify, never as
          // something the brand said.
          source: row.source,
        }))
      : null,
    "db:brand_faq_entries",
  );
}

type BrandSheet = {
  slug: string;
  name: string;
  facts: Record<string, Fact<unknown>>;
  missing: string[];
};

type FactSheet = {
  generatedAt: string;
  event: {
    slug: string;
    sourceFile: string;
    facts: Record<string, Fact<unknown>>;
  } | null;
  brands: BrandSheet[];
  unresolvedSlugs: string[];
  warnings: string[];
};

async function main(): Promise<void> {
  const eventSlug = argValue("--event");
  const brandsArg = argValue("--brands");
  const outPath = argValue("--out");

  if (!eventSlug && !brandsArg) {
    throw new Error(
      "Nothing to describe. Pass --event <event-slug> and/or --brands <slug,slug,...>.",
    );
  }

  // Checked before any client is built: `createServiceClient` asserts these
  // non-null and would otherwise fail deep inside PostgREST as an opaque
  // "Invalid API key" instead of naming the missing variable.
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const explicitSlugs = (brandsArg ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);

  let eventSection: FactSheet["event"] = null;
  let lineup = new Map<
    string,
    { entry: NonNullable<EventFile["brands"]>[number]; index: number }
  >();
  let eventFilePath = "";

  if (eventSlug) {
    const { path, data } = await loadEventFile(eventSlug);
    eventFilePath = path;
    lineup = indexEventLineup(data);

    const collector = new FactCollector();
    for (const key of EVENT_FACT_KEYS) {
      collector.add(key, data[key], `file:${path}#${key}`);
    }
    eventSection = {
      slug: eventSlug,
      sourceFile: path,
      facts: collector.facts,
    };
  }

  // Union, deduped, lineup order first so an event sheet reads in booth order.
  const requestedSlugs = [...new Set([...lineup.keys(), ...explicitSlugs])];

  const supabase = createServiceClient();

  // Approved brands only, and renamed slugs are followed one hop through
  // `brand_slug_redirects` — both behaviours come free with the service and are
  // exactly right here: an event file pinned a slug that a later refresh
  // renamed, and the fact sheet should still find the brand.
  const brandsBySlug = await getBrandsBySlugs(requestedSlugs);

  const resolved = requestedSlugs
    .map((slug) => ({ slug, brand: brandsBySlug.get(slug) }))
    .filter(
      (row): row is { slug: string; brand: Brand } => row.brand !== undefined,
    );
  const unresolvedSlugs = requestedSlugs.filter(
    (slug) => !brandsBySlug.has(slug),
  );

  const brandIds = [...new Set(resolved.map((row) => row.brand.id))];
  const [siteContentById, faqResult, stockistsByBrandId] = await Promise.all([
    fetchSiteContent(supabase, brandIds),
    fetchFaqRows(supabase, brandIds),
    fetchStockists(supabase, brandIds),
  ]);

  const brands: BrandSheet[] = resolved.map(({ slug, brand }) => {
    const collector = new FactCollector();

    const lineupEntry = lineup.get(slug);
    if (lineupEntry) {
      const { entry, index } = lineupEntry;
      const marker = (field: string) =>
        `file:${eventFilePath}#brands[${index}].${field}`;
      collector.add("booth", entry.booth, marker("booth"));
      collector.add("area", entry.area, marker("area"));
      collector.add("areaEn", entry.areaEn, marker("areaEn"));
    }

    collectBrandFacts(brand, collector);
    collectSiteContentFacts(siteContentById.get(brand.id), collector);
    collectFaqFacts(faqResult.rows.get(brand.id), collector);
    collector.add(
      "channels",
      stockistsByBrandId.get(brand.id),
      "db:brand_channels",
    );

    return {
      // The slug the caller asked for, which may be a pre-rename alias; the
      // brand's own current slug is what any URL should be built from.
      slug,
      name: brand.name,
      facts: collector.facts,
      missing: collector.missing,
    };
  });

  const sheet: FactSheet = {
    generatedAt: new Date().toISOString(),
    event: eventSection,
    brands,
    unresolvedSlugs,
    warnings: faqResult.warnings,
  };

  const json = JSON.stringify(sheet, null, 2);
  if (outPath) {
    const target = resolve(process.cwd(), outPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${json}\n`, "utf8");
    // stderr, so `--out` and a piped stdout never mix machine output with chatter.
    console.error(
      `Wrote ${brands.length} brand(s) to ${outPath}` +
        (unresolvedSlugs.length > 0
          ? `; ${unresolvedSlugs.length} slug(s) unresolved`
          : ""),
    );
  } else {
    console.log(json);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
