import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { fixBannedTerms } from "../src/lib/i18n/banned-terms";
import { localizeToTW } from "../src/lib/services/taiwan-localization";

/**
 * Cleans already-stored zh-TW text: FORMATTING via `localizeToTW` (markdown,
 * emoji, punctuation, AI-tool artifacts) and VOCABULARY via `fixBannedTerms`.
 *
 * The two passes are separate on purpose. `localizeToTW` used to carry its own
 * 48-rule vocabulary table which corrupted stored text by rewriting substrings
 * inside correct zh-TW words; the vocabulary list now lives in one place with
 * longest-first matching, and this script is one of its two consumers. The other
 * is the service-layer write guard — a backfill alone cannot hold the line,
 * because enrichment re-authors these rows.
 *
 * NO model call, NO curation job. Pure string work over rows the service role
 * can read, which is what makes it safe to re-run.
 *
 * Run: `pnpm backfill:tw -- --dry-run` (staging by construction; see the
 * package script's `--env-file`).
 */

const BATCH_SIZE = 10;

/** Only `from` is used, so a test double is a legitimate client here. */
export type BackfillSupabase = Pick<SupabaseClient, "from">;

export type CliOptions = {
  dryRun: boolean;
};

export type BrandRow = {
  id: string;
  name: string | null;
  description: string | null;
  blurb: string | null;
  reputation_summary: unknown;
};

export type FaqRow = {
  brand_id: string;
  preset_id: string;
  position: number;
  question_zh: string | null;
  answer_zh: string | null;
};

export type ImageRow = {
  id: string;
  alt_zh: string | null;
};

export type CuratedProductRow = {
  id: string;
  name_zh: string | null;
  product_description_zh: string | null;
};

export type ExhibitorRow = {
  id: string;
  summary_zh: string | null;
  image_alt_zh: string | null;
};

/** An update keyed by `id`, carrying only the columns that actually changed. */
export type IdPatch = {
  id: string;
  patch: Record<string, unknown>;
};

/** `brand_faq_entries` has a composite key, so its patch carries all three. */
export type FaqPatch = {
  brandId: string;
  presetId: string;
  position: number;
  patch: Record<string, unknown>;
};

type BackfillCounts = {
  updated: number;
};

function createServiceClient(): BackfillSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createSupabaseClient(url, serviceRoleKey);
}

function parseArgs(argv: string[]): CliOptions {
  return { dryRun: argv.includes("--dry-run") };
}

/**
 * Formatting first, vocabulary second. Order matters: `localizeToTW` strips
 * markdown and emoji, which can otherwise sit inside a banned term and hide it
 * from the matcher.
 */
export function localizeString(
  value: unknown,
  brandName?: string,
): { value: string; changed: boolean } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const formatted = localizeToTW(
    value,
    brandName ? { brandName } : undefined,
  ).text;
  const corrected = fixBannedTerms(formatted).text;
  return { value: corrected, changed: corrected !== value };
}

/**
 * `reputation_summary` is jsonb with a zh `text` and an English `textEn`. Both
 * render, so both are cleaned — the English side still carries the formatting
 * pass, and the vocabulary list includes romanised slang that reaches it.
 */
export function localizeReputationSummary(
  value: unknown,
  brandName?: string,
): { value: unknown; changed: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { value, changed: false };
  const summary = value as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const key of ["text", "textEn"] as const) {
    const localized = localizeString(summary[key], brandName);
    if (localized?.changed) patch[key] = localized.value;
  }
  if (Object.keys(patch).length === 0) return { value, changed: false };

  return { value: { ...summary, ...patch }, changed: true };
}

/**
 * Build a patch from a fixed column list. Returns `{}` when nothing changed, so
 * a caller can skip the row on `Object.keys(...).length === 0` — an untouched
 * column is never rewritten with its own value.
 */
function patchColumns<T extends Record<string, unknown>>(
  row: T,
  columns: readonly (keyof T & string)[],
  brandName?: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const column of columns) {
    const localized = localizeString(row[column], brandName);
    if (localized?.changed) patch[column] = localized.value;
  }
  return patch;
}

export function buildBrandPatches(rows: readonly BrandRow[]): IdPatch[] {
  return rows.flatMap((brand) => {
    const brandName = brand.name ?? undefined;
    const patch = patchColumns(brand, ["description", "blurb"], brandName);
    const reputation = localizeReputationSummary(
      brand.reputation_summary,
      brandName,
    );
    if (reputation.changed) patch.reputation_summary = reputation.value;

    return Object.keys(patch).length > 0 ? [{ id: brand.id, patch }] : [];
  });
}

export function buildFaqPatches(rows: readonly FaqRow[]): FaqPatch[] {
  return rows.flatMap((row) => {
    const patch = patchColumns(row, ["question_zh", "answer_zh"]);
    return Object.keys(patch).length > 0
      ? [
          {
            brandId: row.brand_id,
            presetId: row.preset_id,
            position: row.position,
            patch,
          },
        ]
      : [];
  });
}

export function buildImagePatches(rows: readonly ImageRow[]): IdPatch[] {
  return rows.flatMap((image) => {
    const patch = patchColumns(image, ["alt_zh"]);
    return Object.keys(patch).length > 0 ? [{ id: image.id, patch }] : [];
  });
}

export function buildCuratedProductPatches(
  rows: readonly CuratedProductRow[],
): IdPatch[] {
  return rows.flatMap((product) => {
    const patch = patchColumns(product, [
      "name_zh",
      "product_description_zh",
    ]);
    return Object.keys(patch).length > 0 ? [{ id: product.id, patch }] : [];
  });
}

export function buildExhibitorPatches(
  rows: readonly ExhibitorRow[],
): IdPatch[] {
  return rows.flatMap((exhibitor) => {
    const patch = patchColumns(exhibitor, ["summary_zh", "image_alt_zh"]);
    return Object.keys(patch).length > 0 ? [{ id: exhibitor.id, patch }] : [];
  });
}

async function inBatches<T>(
  items: readonly T[],
  callback: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    await Promise.all(items.slice(index, index + BATCH_SIZE).map(callback));
  }
}

/** `--dry-run` stops HERE: the patches are built and reported, never issued. */
async function applyIdPatches(
  supabase: BackfillSupabase,
  table: string,
  updates: readonly IdPatch[],
  options: CliOptions,
): Promise<BackfillCounts> {
  if (!options.dryRun) {
    await inBatches(updates, async ({ id, patch }) => {
      const { error } = await supabase.from(table).update(patch).eq("id", id);
      if (error) throw error;
    });
  }
  return { updated: updates.length };
}

export async function backfillBrands(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, description, blurb, reputation_summary")
    .order("id", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as BrandRow[];
  return applyIdPatches(supabase, "brands", buildBrandPatches(rows), options);
}

export async function backfillFaq(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from("brand_faq_entries")
    .select("brand_id, preset_id, position, question_zh, answer_zh");
  if (error) throw error;

  const updates = buildFaqPatches((data ?? []) as unknown as FaqRow[]);

  if (!options.dryRun) {
    await inBatches(updates, async ({ brandId, presetId, position, patch }) => {
      const { error } = await supabase
        .from("brand_faq_entries")
        .update(patch)
        .eq("brand_id", brandId)
        .eq("preset_id", presetId)
        .eq("position", position);
      if (error) throw error;
    });
  }

  return { updated: updates.length };
}

export async function backfillImages(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from("brand_images")
    .select("id, alt_zh")
    .not("alt_zh", "is", null);
  if (error) throw error;

  return applyIdPatches(
    supabase,
    "brand_images",
    buildImagePatches((data ?? []) as unknown as ImageRow[]),
    options,
  );
}

export async function backfillCuratedProducts(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from("curated_products")
    .select("id, name_zh, product_description_zh");
  if (error) throw error;

  return applyIdPatches(
    supabase,
    "curated_products",
    buildCuratedProductPatches((data ?? []) as unknown as CuratedProductRow[]),
    options,
  );
}

export async function backfillExhibitors(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from("event_exhibitors")
    .select("id, summary_zh, image_alt_zh");
  if (error) throw error;

  return applyIdPatches(
    supabase,
    "event_exhibitors",
    buildExhibitorPatches((data ?? []) as unknown as ExhibitorRow[]),
    options,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supabase = createServiceClient();
  const [brands, faq, images, products, exhibitors] = await Promise.all([
    backfillBrands(supabase, options),
    backfillFaq(supabase, options),
    backfillImages(supabase, options),
    backfillCuratedProducts(supabase, options),
    backfillExhibitors(supabase, options),
  ]);

  console.log(
    [
      `Brands: ${brands.updated} updated`,
      `FAQ: ${faq.updated} updated`,
      `Images: ${images.updated} updated`,
      `Curated products: ${products.updated} updated`,
      `Exhibitors: ${exhibitors.updated} updated`,
    ].join(", "),
  );
  if (options.dryRun) console.log("Dry run complete. No changes made.");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

if (process.argv[1]?.endsWith("backfill-tw-localization.ts")) {
  void main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
