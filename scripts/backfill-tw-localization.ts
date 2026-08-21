import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  detectBannedTerms,
  fixBannedTerms,
} from "../src/lib/i18n/banned-terms";
import { localizeToTW } from "../src/lib/services/taiwan-localization";
import { ARTIFACT_ROOT } from "./shared/artifact";

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
 * Every read is PAGED. PostgREST caps an unpaged select at `db-max-rows`
 * (1000) and returns success, so an unpaged version of this script would
 * migrate the first 1000 rows of each table and report a clean second dry run
 * while thousands of rows stayed dirty — `brand_images` alone is past that cap
 * on staging. Each page carries a deterministic `.order(...)` on the table's
 * primary key so pages can neither overlap nor skip.
 *
 * DEV-1546: the service-layer write guard no longer mutates, so this script is
 * the ONLY thing that rewrites stored zh-TW text — and a human reading its dry
 * run is the entire safety mechanism. `fixBannedTerms` matches substrings
 * (Chinese has no word delimiters), so it also rewrites correct Taiwanese words
 * that merely CONTAIN a banned term: 台南市保安路 -> 保全路, 人潮密集成長 ->
 * 密整合長. Only a reader can tell those apart from a real correction, so
 * `--dry-run` writes the COMPLETE diff to a file — every patch, every table,
 * full before/after — and the terminal keeps only a preview. The old 10-row /
 * 80-character terminal sample could not carry that review: on staging one
 * sample line printed an identical before and after, because the actual change
 * sat past the elision cutoff.
 *
 * Run: `pnpm backfill:tw -- --dry-run` (staging by construction; see the
 * package script's `--env-file`).
 */

/** Rows updated per concurrent write batch. */
const BATCH_SIZE = 10;

/** Rows read per select. Must stay at or below PostgREST's `db-max-rows`. */
export const PAGE_SIZE = 500;

/**
 * How many `id | field | before -> after` lines a dry run PREVIEWS per table.
 * A preview only — the reviewable record is the report file, which is capped by
 * nothing.
 */
const DRY_RUN_SAMPLE_LIMIT = 10;

/** How much of a value a dry-run preview line shows before eliding. */
const SAMPLE_TEXT_LIMIT = 80;

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

/** One banned term, and how many times a patch corrected it. */
export type TermCount = {
  term: string;
  replacement: string;
  count: number;
};

/**
 * One field of one row this dry run would rewrite, in full.
 *
 * `before` and `after` are never truncated and never whitespace-collapsed: the
 * reviewer is checking a substring rewrite, and the character that distinguishes
 * a correction from a corruption may sit anywhere in the value.
 */
export type DryRunEntry = {
  table: string;
  /**
   * The row's primary key. `{ id }` for four tables; `brand_faq_entries` keys on
   * `{ brand_id, preset_id, position }` and carries all three, or the reviewer
   * cannot find the row they are approving.
   */
  key: Record<string, string | number>;
  /** The database column (snake_case). */
  field: string;
  before: string;
  after: string;
  /** The banned terms that fired IN THIS FIELD, with per-occurrence counts. */
  terms: TermCount[];
};

/**
 * What a dry run reports beyond the row count. The counts alone are unfalsifiable
 * — the operator's safety check is "which terms did this want to rewrite", and
 * that question needs the terms themselves in the output.
 */
export type DryRunDetail = {
  terms: TermCount[];
  /** `key | column | before -> after`, capped at DRY_RUN_SAMPLE_LIMIT. */
  samples: string[];
  /** Every patched field, uncapped and untruncated. Serialised to the report. */
  entries: DryRunEntry[];
};

/** The on-disk dry-run artifact. JSON so it is greppable and diffable. */
export type DryRunReport = {
  generatedAt: string;
  entryCount: number;
  /** Patched-row counts per table, matching the terminal summary. */
  rowsByTable: Record<string, number>;
  /** Banned-term totals across all tables. */
  terms: TermCount[];
  entries: DryRunEntry[];
};

export type BackfillCounts = {
  updated: number;
  /** Present only on `--dry-run`; a real run keeps its concise output. */
  dryRun?: DryRunDetail;
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
    const patch = patchColumns(product, ["name_zh", "product_description_zh"]);
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

/**
 * The slice of the PostgREST builder this script uses. Declared structurally so
 * the paging loop can reassign `query` across `.order(...)` calls, and so a test
 * double stays a handful of lines.
 */
type PagedQuery = {
  order(column: string, options: { ascending: boolean }): PagedQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

type ReadSpec = {
  table: string;
  select: string;
  /** Primary-key columns, in order. Deterministic paging depends on this. */
  order: readonly string[];
  /**
   * Localizable columns. A row where all of them are null can never produce a
   * patch, so it is filtered at the database rather than fetched and discarded.
   * `.or(...)` is used even for single-column tables to keep one code path.
   */
  textColumns: readonly string[];
};

/**
 * Read a table page by page, handing each page to `onPage`. Stops on the first
 * short page, which is the only reliable end signal: a full page may be the
 * last one, and PostgREST returns no total unless asked for an exact count.
 */
async function readPaged<Row>(
  supabase: BackfillSupabase,
  spec: ReadSpec,
  onPage: (rows: Row[]) => Promise<void>,
): Promise<void> {
  const nullFilter = spec.textColumns
    .map((column) => `${column}.not.is.null`)
    .join(",");

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(spec.table)
      .select(spec.select)
      .or(nullFilter) as unknown as PagedQuery;
    for (const column of spec.order) {
      query = query.order(column, { ascending: true });
    }

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as Row[];
    if (rows.length > 0) await onPage(rows);
    if (rows.length < PAGE_SIZE) return;
  }
}

type DryRunAccumulator = {
  terms: Map<string, TermCount>;
  samples: string[];
  entries: DryRunEntry[];
};

function createDryRunAccumulator(): DryRunAccumulator {
  return { terms: new Map(), samples: [], entries: [] };
}

/**
 * Render any patchable value as text, verbatim. jsonb columns are stringified
 * because they have no other textual form; strings are passed through untouched,
 * newlines and all — this is what the reviewer reads.
 */
function toText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** Collapse to one line. Preview only; never applied to a report entry. */
function toLine(value: unknown): string {
  return toText(value).replace(/\s+/g, " ").trim();
}

function elide(text: string): string {
  return text.length > SAMPLE_TEXT_LIMIT
    ? `${text.slice(0, SAMPLE_TEXT_LIMIT)}…`
    : text;
}

function countTerm(
  into: Map<string, TermCount>,
  term: string,
  replacement: string,
): void {
  const existing = into.get(term);
  if (existing) existing.count += 1;
  else into.set(term, { term, replacement, count: 1 });
}

/**
 * Record what one patch would change: one uncapped report entry per patched
 * field, plus the terminal preview line while it is under its cap.
 *
 * Terms are counted from the BEFORE value, so a patch caused purely by
 * formatting contributes an entry and no term — which is itself the signal the
 * operator wants.
 */
function recordDryRun(
  accumulator: DryRunAccumulator,
  table: string,
  key: Record<string, string | number>,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [field, after] of Object.entries(patch)) {
    const before = toText(row[field]);
    const afterText = toText(after);

    const fieldTerms = new Map<string, TermCount>();
    for (const hit of detectBannedTerms(before)) {
      countTerm(fieldTerms, hit.term, hit.replacement);
      countTerm(accumulator.terms, hit.term, hit.replacement);
    }

    accumulator.entries.push({
      table,
      key,
      field,
      before,
      after: afterText,
      terms: [...fieldTerms.values()],
    });

    if (accumulator.samples.length < DRY_RUN_SAMPLE_LIMIT) {
      accumulator.samples.push(
        `${Object.values(key).join("/")} | ${field} | ${elide(
          toLine(before),
        )} -> ${elide(toLine(afterText))}`,
      );
    }
  }
}

function finishDryRun(accumulator: DryRunAccumulator): DryRunDetail {
  return {
    terms: [...accumulator.terms.values()].sort((a, b) => b.count - a.count),
    samples: accumulator.samples,
    entries: accumulator.entries,
  };
}

/** The per-table shape a generic backfill needs. */
export type IdTableConfig = {
  table: string;
  select: string;
  /** Columns that may hold localizable text — also the null filter. */
  textColumns: readonly string[];
  /**
   * Rows arrive untyped from PostgREST — the select list is a string, so the
   * cast has to happen somewhere. It happens once per config, next to the
   * select list it has to agree with.
   */
  buildPatches: (rows: readonly Record<string, unknown>[]) => IdPatch[];
};

export const BRANDS_TABLE: IdTableConfig = {
  table: "brands",
  select: "id, name, description, blurb, reputation_summary",
  // `name` is read for context (localizeToTW strips it out of prose) but is
  // never patched, so it is not part of the null filter.
  textColumns: ["description", "blurb", "reputation_summary"],
  buildPatches: (rows) => buildBrandPatches(rows as unknown as BrandRow[]),
};

export const IMAGES_TABLE: IdTableConfig = {
  table: "brand_images",
  select: "id, alt_zh",
  textColumns: ["alt_zh"],
  buildPatches: (rows) => buildImagePatches(rows as unknown as ImageRow[]),
};

export const CURATED_PRODUCTS_TABLE: IdTableConfig = {
  table: "curated_products",
  select: "id, name_zh, product_description_zh",
  textColumns: ["name_zh", "product_description_zh"],
  buildPatches: (rows) =>
    buildCuratedProductPatches(rows as unknown as CuratedProductRow[]),
};

export const EXHIBITORS_TABLE: IdTableConfig = {
  table: "event_exhibitors",
  select: "id, summary_zh, image_alt_zh",
  textColumns: ["summary_zh", "image_alt_zh"],
  buildPatches: (rows) =>
    buildExhibitorPatches(rows as unknown as ExhibitorRow[]),
};

/** Every `id`-keyed table, in report order. */
export const ID_TABLES = [
  BRANDS_TABLE,
  IMAGES_TABLE,
  CURATED_PRODUCTS_TABLE,
  EXHIBITORS_TABLE,
] as const;

/**
 * Read → patch → write one `id`-keyed table.
 *
 * `--dry-run` stops before the write: patches are built and reported, never
 * issued. That is a contract, not an optimisation.
 */
export async function backfillTable(
  supabase: BackfillSupabase,
  config: IdTableConfig,
  options: CliOptions,
): Promise<BackfillCounts> {
  const accumulator = options.dryRun ? createDryRunAccumulator() : null;
  let updated = 0;

  await readPaged<Record<string, unknown>>(
    supabase,
    {
      table: config.table,
      select: config.select,
      order: ["id"],
      textColumns: config.textColumns,
    },
    async (rows) => {
      const patches = config.buildPatches(rows);
      updated += patches.length;

      if (accumulator) {
        const byId = new Map(rows.map((row) => [String(row.id), row]));
        for (const { id, patch } of patches) {
          recordDryRun(
            accumulator,
            config.table,
            { id },
            byId.get(id) ?? {},
            patch,
          );
        }
      }

      if (!options.dryRun) {
        await inBatches(patches, async ({ id, patch }) => {
          const { error } = await supabase
            .from(config.table)
            .update(patch)
            .eq("id", id);
          if (error) throw error;
        });
      }
    },
  );

  return accumulator
    ? { updated, dryRun: finishDryRun(accumulator) }
    : { updated };
}

/**
 * `brand_faq_entries` keeps its own function: its primary key is the composite
 * `(brand_id, preset_id, position)`, so both the page ordering and the update
 * predicate take three columns instead of one. Folding it into the generic
 * `IdTableConfig` would mean parameterising the key everywhere to save four
 * lines here.
 */
export async function backfillFaq(
  supabase: BackfillSupabase,
  options: CliOptions,
): Promise<BackfillCounts> {
  const accumulator = options.dryRun ? createDryRunAccumulator() : null;
  let updated = 0;

  await readPaged<FaqRow>(
    supabase,
    {
      table: "brand_faq_entries",
      select: "brand_id, preset_id, position, question_zh, answer_zh",
      order: ["brand_id", "preset_id", "position"],
      textColumns: ["question_zh", "answer_zh"],
    },
    async (rows) => {
      const updates = buildFaqPatches(rows);
      updated += updates.length;

      if (accumulator) {
        for (const update of updates) {
          const row = rows.find(
            (candidate) =>
              candidate.brand_id === update.brandId &&
              candidate.preset_id === update.presetId &&
              candidate.position === update.position,
          );
          recordDryRun(
            accumulator,
            "brand_faq_entries",
            {
              brand_id: update.brandId,
              preset_id: update.presetId,
              position: update.position,
            },
            (row ?? {}) as unknown as Record<string, unknown>,
            update.patch,
          );
        }
      }

      if (!options.dryRun) {
        await inBatches(
          updates,
          async ({ brandId, presetId, position, patch }) => {
            const { error } = await supabase
              .from("brand_faq_entries")
              .update(patch)
              .eq("brand_id", brandId)
              .eq("preset_id", presetId)
              .eq("position", position);
            if (error) throw error;
          },
        );
      }
    },
  );

  return accumulator
    ? { updated, dryRun: finishDryRun(accumulator) }
    : { updated };
}

/**
 * The dry-run report for one table. Without the terms, the operator's safety
 * check ("does this rewrite anything it should not?") has nothing to read.
 */
export function formatDryRunDetail(
  label: string,
  detail: DryRunDetail,
): string {
  const terms =
    detail.terms.length > 0
      ? detail.terms
          .map((entry) => `${entry.term}->${entry.replacement} x${entry.count}`)
          .join(", ")
      : "no banned terms (formatting only)";

  return [`${label}: ${terms}`, ...detail.samples.map((s) => `    ${s}`)].join(
    "\n",
  );
}

/**
 * Where the complete dry-run diff lands.
 *
 * `ARTIFACT_ROOT` (~/project/.artifact/formoria) is the repo's existing home for
 * operator review artifacts: it is outside the working tree, so it can be
 * neither committed nor destroyed by `git clean -xdf`. Nothing new is invented
 * and no `.gitignore` entry is required.
 *
 * The name carries a second-resolution timestamp AND the pid, so two concurrent
 * runs cannot overwrite each other's evidence — the failure mode that matters
 * here is a reviewer approving a diff they did not read.
 */
export function dryRunReportPath(
  now: Date = new Date(),
  pid: number = process.pid,
): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return resolve(ARTIFACT_ROOT, `backfill-tw-dry-run_${stamp}_${pid}.json`);
}

/** Merge the per-table dry-run details into one whole-run report. */
export function buildDryRunReport(
  sections: readonly (readonly [string, BackfillCounts])[],
  now: Date = new Date(),
): DryRunReport {
  const entries: DryRunEntry[] = [];
  const rowsByTable: Record<string, number> = {};
  const terms = new Map<string, TermCount>();

  for (const [label, counts] of sections) {
    rowsByTable[label] = counts.updated;
    for (const entry of counts.dryRun?.entries ?? []) entries.push(entry);
    for (const term of counts.dryRun?.terms ?? []) {
      const existing = terms.get(term.term);
      if (existing) existing.count += term.count;
      else terms.set(term.term, { ...term });
    }
  }

  return {
    generatedAt: now.toISOString(),
    entryCount: entries.length,
    rowsByTable,
    terms: [...terms.values()].sort((a, b) => b.count - a.count),
    entries,
  };
}

/**
 * Write the complete dry-run diff, and only on a dry run. Returns the path
 * written, or `null` when there was nothing to write — a real run keeps its
 * concise output and leaves no artifact behind.
 *
 * `JSON.stringify` emits zh-TW as literal characters (it escapes only control
 * characters and lone surrogates), so the file is readable without any
 * post-processing. That is a requirement, not a happy accident: an operator who
 * has to un-escape `\uXXXX` before reviewing will not review.
 */
export async function reportDryRun(
  options: CliOptions,
  sections: readonly (readonly [string, BackfillCounts])[],
  filePath: string = dryRunReportPath(),
): Promise<string | null> {
  if (!options.dryRun) return null;

  const report = buildDryRunReport(sections);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supabase = createServiceClient();

  const [brands, images, products, exhibitors, faq] = await Promise.all([
    ...ID_TABLES.map((config) => backfillTable(supabase, config, options)),
    backfillFaq(supabase, options),
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

  if (options.dryRun) {
    const labelled: [string, BackfillCounts][] = [
      ["brands", brands],
      ["brand_images", images],
      ["curated_products", products],
      ["event_exhibitors", exhibitors],
      ["brand_faq_entries", faq],
    ];
    for (const [label, counts] of labelled) {
      if (counts.dryRun && counts.updated > 0) {
        console.log(formatDryRunDetail(label, counts.dryRun));
      }
    }

    // The sample lines above are a preview. This file is the thing to review.
    const reportPath = await reportDryRun(options, labelled);
    console.log("Dry run complete. No changes made.");
    console.log("");
    console.log(`Full diff (every patch, untruncated): ${reportPath}`);
    console.log("Review it before running without --dry-run.");
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

// `pathToFileURL` is the repo's entry-guard idiom (see db-deploy.ts,
// curate-brands.ts, posthog-sync.ts). An `endsWith("backfill-tw-localization.ts")`
// check also fires for any unrelated path that happens to end in this filename.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
