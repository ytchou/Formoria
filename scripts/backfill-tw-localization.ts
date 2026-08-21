import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { fixBannedTerms } from "../src/lib/i18n/banned-terms";
import { localizeToTW } from "../src/lib/services/taiwan-localization";
import { artifactPath } from "./shared/artifact";

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
 * that merely CONTAIN a banned term: 台南市保安路 -> 保全路, 公共安全局 ->
 * 公共安全域. Only a reader can tell those apart from a real correction, so
 * `--dry-run` STREAMS the complete diff to a file — every patch, every table,
 * full before/after — and the terminal keeps only counts.
 *
 * The report is NDJSON, one JSON object per line, written as patches are
 * produced:
 *
 *   1. a `header` line — when, and WHICH DATABASE (see `supabaseEnvironment`);
 *   2. one `patch` line per rewritten field, untruncated;
 *   3. a `summary` line — entry count, per-table row counts, per-term totals,
 *      and the environment again, so a grep for either finds it.
 *
 * Streaming rather than one `JSON.stringify` of an accumulated array: a first
 * full-table run holds every before AND after of every patched field across
 * five tables resident at once, plus the pretty-printer's buffer, and an OOM
 * there loses the exact artifact this design depends on. A line-per-patch file
 * is also greppable, and a crash mid-run leaves a partial artifact instead of
 * none.
 *
 * Run: `pnpm backfill:tw -- --dry-run` (staging by construction; see the
 * package script's `--env-file`).
 */

/** Rows updated per concurrent write batch. */
const BATCH_SIZE = 10;

/** Rows read per select. Must stay at or below PostgREST's `db-max-rows`. */
export const PAGE_SIZE = 500;

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

/** One banned term, and how many times a patch corrected it. */
export type TermCount = {
  term: string;
  replacement: string;
  count: number;
};

/**
 * The banned terms a patch actually corrected, keyed by column.
 *
 * Carried on the patch rather than recomputed: `fixBannedTerms` already returns
 * its substitutions, and re-scanning every patched value a second time across
 * five tables is both wasted work and a second answer to the same question.
 */
export type PatchTerms = Record<string, TermCount[]>;

/** An update keyed by `id`, carrying only the columns that actually changed. */
export type IdPatch = {
  id: string;
  patch: Record<string, unknown>;
  terms: PatchTerms;
};

/** `brand_faq_entries` has a composite key, so its patch carries all three. */
export type FaqPatch = {
  brandId: string;
  presetId: string;
  position: number;
  patch: Record<string, unknown>;
  terms: PatchTerms;
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
 * Which database a report describes.
 *
 * Both `.env.local` and `.env.staging` point at the STAGING project, and
 * production credentials arrive through a separate `supabase projects api-keys
 * --reveal` step — so two reports are otherwise indistinguishable, and a
 * reviewer can approve one environment's diff and apply it against the other.
 * Derived from `NEXT_PUBLIC_SUPABASE_URL`; no new env var, and the service-role
 * key never appears here.
 */
export type SupabaseEnvironment = {
  /** The Supabase project ref, e.g. `xwkigpvnheecihpxyvsl`. */
  projectRef: string;
  /** The host it came from, so a self-hosted or local URL is still identified. */
  host: string;
};

/** First line of the report. */
export type DryRunHeader = {
  kind: "header";
  generatedAt: string;
  environment: SupabaseEnvironment;
};

/** One line per rewritten field. */
export type DryRunPatchLine = DryRunEntry & { kind: "patch" };

/**
 * Last line of the report. The counts alone are unfalsifiable — the operator's
 * safety check is "which terms did this want to rewrite", and that question
 * needs the terms themselves in the output.
 */
export type DryRunSummary = {
  kind: "summary";
  generatedAt: string;
  environment: SupabaseEnvironment;
  entryCount: number;
  /** Patched-row counts per table, matching the terminal summary. */
  rowsByTable: Record<string, number>;
  /** Banned-term totals across all tables. */
  terms: TermCount[];
};

export type DryRunLine = DryRunHeader | DryRunPatchLine | DryRunSummary;

/** What a dry run reports beyond the row count. */
export type DryRunDetail = {
  terms: TermCount[];
};

export type BackfillCounts = {
  updated: number;
  /** Present only on `--dry-run`; a real run keeps its concise output. */
  dryRun?: DryRunDetail;
};

/**
 * Where a dry-run entry goes. Declared as the narrowest possible interface so
 * the backfill functions do not depend on a file, and a test can pass an array.
 */
export type DryRunEntrySink = {
  write(entry: DryRunEntry): Promise<void>;
};

const NULL_SINK: DryRunEntrySink = {
  write: async () => {},
};

/**
 * Identify the Supabase project a URL points at.
 *
 * Hosted URLs are `https://<ref>.supabase.co`, so the ref is the first label.
 * Anything else (a local stack, a self-hosted host) has no ref, and the host
 * itself is the most specific identity available — reported rather than
 * dropped, because "which database was this" must always have an answer.
 */
export function supabaseEnvironment(
  url: string | undefined,
): SupabaseEnvironment {
  if (!url) return { projectRef: "unknown", host: "unknown" };

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { projectRef: "unknown", host: "unknown" };
  }

  const hosted = /^([a-z0-9-]+)\.supabase\.(?:co|in|net)$/i.exec(host);
  return {
    projectRef: hosted ? hosted[1]! : host.replace(/[^a-z0-9-]+/gi, "-"),
    host,
  };
}

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

/** Sum `counts` into `into`, merging on the term. */
function addTermCounts(
  into: Map<string, TermCount>,
  counts: Iterable<TermCount>,
): void {
  for (const entry of counts) {
    const existing = into.get(entry.term);
    if (existing) existing.count += entry.count;
    else into.set(entry.term, { ...entry });
  }
}

/** Collapse per-occurrence substitutions into one entry per term. */
function countTerms(
  hits: readonly { term: string; replacement: string }[],
): TermCount[] {
  const into = new Map<string, TermCount>();
  addTermCounts(
    into,
    hits.map((hit) => ({
      term: hit.term,
      replacement: hit.replacement,
      count: 1,
    })),
  );
  return [...into.values()];
}

/**
 * Formatting first, vocabulary second. Order matters: `localizeToTW` strips
 * markdown and emoji, which can otherwise sit inside a banned term and hide it
 * from the matcher.
 *
 * `terms` is what `fixBannedTerms` reports it substituted — the authoritative
 * answer, threaded out to the dry-run report instead of being recomputed there.
 */
export function localizeString(
  value: unknown,
  brandName?: string,
  language: "zh" | "en" = "zh",
): { value: string; changed: boolean; terms: TermCount[] } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const formatted = localizeToTW(value, { brandName, language }).text;
  const { text: corrected, substitutions } = fixBannedTerms(formatted);
  return {
    value: corrected,
    changed: corrected !== value,
    terms: countTerms(substitutions),
  };
}

/**
 * `reputation_summary` is jsonb with a zh `text` and an English `textEn`. Both
 * render, so both are cleaned — the English side still carries the formatting
 * pass, and the vocabulary list includes romanised slang that reaches it.
 *
 * The two keys are cleaned in DIFFERENT LANGUAGES, and that is the whole point
 * of naming them here rather than looping over the object's own keys: `textEn`
 * is English prose, so punctuation normalization is suppressed on it. Without
 * that, a studio name in Han inside an English sentence dragged the surrounding
 * ASCII brackets to full-width and produced a patch with an empty `terms` array
 * — a rewrite no reviewer could attribute to anything (DEV-1547 Class 2).
 */
export function localizeReputationSummary(
  value: unknown,
  brandName?: string,
): { value: unknown; changed: boolean; terms: TermCount[] } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { value, changed: false, terms: [] };
  const summary = value as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  const terms = new Map<string, TermCount>();
  for (const key of ["text", "textEn"] as const) {
    const localized = localizeString(
      summary[key],
      brandName,
      key === "textEn" ? "en" : "zh",
    );
    if (localized?.changed) {
      patch[key] = localized.value;
      addTermCounts(terms, localized.terms);
    }
  }
  if (Object.keys(patch).length === 0)
    return { value, changed: false, terms: [] };

  return {
    value: { ...summary, ...patch },
    changed: true,
    terms: [...terms.values()],
  };
}

/**
 * Build a patch from a fixed column list. Returns an empty patch when nothing
 * changed, so a caller can skip the row on `Object.keys(...).length === 0` — an
 * untouched column is never rewritten with its own value.
 */
function patchColumns<T extends Record<string, unknown>>(
  row: T,
  columns: readonly (keyof T & string)[],
  brandName?: string,
): { patch: Record<string, unknown>; terms: PatchTerms } {
  const patch: Record<string, unknown> = {};
  const terms: PatchTerms = {};
  for (const column of columns) {
    const localized = localizeString(row[column], brandName);
    if (localized?.changed) {
      patch[column] = localized.value;
      terms[column] = localized.terms;
    }
  }
  return { patch, terms };
}

export function buildBrandPatches(rows: readonly BrandRow[]): IdPatch[] {
  return rows.flatMap((brand) => {
    const brandName = brand.name ?? undefined;
    const { patch, terms } = patchColumns(
      brand,
      ["description", "blurb"],
      brandName,
    );
    const reputation = localizeReputationSummary(
      brand.reputation_summary,
      brandName,
    );
    if (reputation.changed) {
      patch.reputation_summary = reputation.value;
      terms.reputation_summary = reputation.terms;
    }

    return Object.keys(patch).length > 0
      ? [{ id: brand.id, patch, terms }]
      : [];
  });
}

export function buildFaqPatches(rows: readonly FaqRow[]): FaqPatch[] {
  return rows.flatMap((row) => {
    const { patch, terms } = patchColumns(row, ["question_zh", "answer_zh"]);
    return Object.keys(patch).length > 0
      ? [
          {
            brandId: row.brand_id,
            presetId: row.preset_id,
            position: row.position,
            patch,
            terms,
          },
        ]
      : [];
  });
}

export function buildImagePatches(rows: readonly ImageRow[]): IdPatch[] {
  return rows.flatMap((image) => {
    const { patch, terms } = patchColumns(image, ["alt_zh"]);
    return Object.keys(patch).length > 0
      ? [{ id: image.id, patch, terms }]
      : [];
  });
}

export function buildCuratedProductPatches(
  rows: readonly CuratedProductRow[],
): IdPatch[] {
  return rows.flatMap((product) => {
    const { patch, terms } = patchColumns(product, [
      "name_zh",
      "product_description_zh",
    ]);
    return Object.keys(patch).length > 0
      ? [{ id: product.id, patch, terms }]
      : [];
  });
}

export function buildExhibitorPatches(
  rows: readonly ExhibitorRow[],
): IdPatch[] {
  return rows.flatMap((exhibitor) => {
    const { patch, terms } = patchColumns(exhibitor, [
      "summary_zh",
      "image_alt_zh",
    ]);
    return Object.keys(patch).length > 0
      ? [{ id: exhibitor.id, patch, terms }]
      : [];
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

/**
 * What a dry run keeps in memory: per-term totals only. Every entry goes
 * straight to the sink, so the resident set does not grow with the table.
 */
type DryRunAccumulator = {
  terms: Map<string, TermCount>;
};

function createDryRunAccumulator(): DryRunAccumulator {
  return { terms: new Map() };
}

/**
 * Render any patchable value as text, verbatim. jsonb columns are stringified
 * because they have no other textual form; strings are passed through untouched,
 * newlines and all — this is what the reviewer reads.
 */
function toText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/**
 * Emit what one patch would change: one report entry per patched field.
 *
 * Terms come from the substitution list `fixBannedTerms` already returned, so a
 * patch caused purely by formatting carries an entry and no term — which is
 * itself the signal the operator wants.
 */
async function recordDryRun(
  accumulator: DryRunAccumulator,
  sink: DryRunEntrySink,
  table: string,
  key: Record<string, string | number>,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
  patchTerms: PatchTerms,
): Promise<void> {
  for (const [field, after] of Object.entries(patch)) {
    const terms = patchTerms[field] ?? [];
    addTermCounts(accumulator.terms, terms);

    await sink.write({
      table,
      key,
      field,
      before: toText(row[field]),
      after: toText(after),
      terms,
    });
  }
}

function finishDryRun(accumulator: DryRunAccumulator): DryRunDetail {
  return {
    terms: [...accumulator.terms.values()].sort((a, b) => b.count - a.count),
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
  sink: DryRunEntrySink | null = null,
): Promise<BackfillCounts> {
  const accumulator = options.dryRun ? createDryRunAccumulator() : null;
  const entrySink = sink ?? NULL_SINK;
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
        for (const { id, patch, terms } of patches) {
          await recordDryRun(
            accumulator,
            entrySink,
            config.table,
            { id },
            byId.get(id) ?? {},
            patch,
            terms,
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
  sink: DryRunEntrySink | null = null,
): Promise<BackfillCounts> {
  const accumulator = options.dryRun ? createDryRunAccumulator() : null;
  const entrySink = sink ?? NULL_SINK;
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
          await recordDryRun(
            accumulator,
            entrySink,
            "brand_faq_entries",
            {
              brand_id: update.brandId,
              preset_id: update.presetId,
              position: update.position,
            },
            (row ?? {}) as unknown as Record<string, unknown>,
            update.patch,
            update.terms,
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
 * The per-term totals for the terminal. Without them, the operator's safety
 * check ("does this rewrite anything it should not?") has nothing to read
 * before opening the file.
 */
export function formatTermTotals(terms: readonly TermCount[]): string {
  if (terms.length === 0) return "Banned terms: none (formatting changes only)";
  return [
    "Banned terms this run would rewrite:",
    ...terms.map(
      (entry) => `  ${entry.term} -> ${entry.replacement}  x${entry.count}`,
    ),
  ].join("\n");
}

/**
 * Where the complete dry-run diff lands.
 *
 * `ARTIFACT_ROOT` (~/project/.artifact/formoria) is the repo's existing home for
 * operator review artifacts: it is outside the working tree, so it can be
 * neither committed nor destroyed by `git clean -xdf`. Nothing new is invented
 * and no `.gitignore` entry is required.
 *
 * The name carries the SUPABASE PROJECT REF, a second-resolution timestamp and
 * the pid. The ref because two environments' reports are otherwise
 * indistinguishable on disk; the pid because a second-resolution stamp alone
 * lets two concurrent runs overwrite each other's evidence — and the failure
 * mode that matters here is a reviewer approving a diff they did not read, or
 * read for the wrong database.
 */
export function dryRunReportPath(options: {
  projectRef: string;
  now?: Date;
  pid?: number;
}): string {
  return artifactPath(`backfill-tw-dry-run_${options.projectRef}`, {
    prefix: "",
    ext: "ndjson",
    suffix: options.pid ?? process.pid,
    now: options.now,
  });
}

/** Merge the per-table dry-run details into the report's closing line. */
export function buildDryRunSummary(
  sections: readonly (readonly [string, BackfillCounts])[],
  entryCount: number,
  environment: SupabaseEnvironment,
  now: Date = new Date(),
): DryRunSummary {
  const rowsByTable: Record<string, number> = {};
  const terms = new Map<string, TermCount>();

  for (const [label, counts] of sections) {
    rowsByTable[label] = counts.updated;
    addTermCounts(terms, counts.dryRun?.terms ?? []);
  }

  return {
    kind: "summary",
    generatedAt: now.toISOString(),
    environment,
    entryCount,
    rowsByTable,
    terms: [...terms.values()].sort((a, b) => b.count - a.count),
  };
}

export type DryRunReportWriter = DryRunEntrySink & {
  /** The file being written. Always a real path — never `null`. */
  readonly path: string;
  /** Write the summary line, close the file, and return what it summarises. */
  finish(
    sections: readonly (readonly [string, BackfillCounts])[],
  ): Promise<DryRunSummary>;
};

/**
 * Open the streaming dry-run report and write its header.
 *
 * `JSON.stringify` emits zh-TW as literal characters (it escapes only control
 * characters and lone surrogates), so the file is readable without any
 * post-processing. That is a requirement, not a happy accident: an operator who
 * has to un-escape `\uXXXX` before reviewing will not review.
 */
export async function createDryRunReport(
  filePath: string,
  environment: SupabaseEnvironment,
  now: Date = new Date(),
): Promise<DryRunReportWriter> {
  await mkdir(dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: "utf8" });

  // A stream error while nothing is awaiting `drain` would otherwise be an
  // unhandled 'error' event; captured here and rethrown at the next write, so a
  // half-written report fails the run rather than passing as a complete one.
  const failures: Error[] = [];
  stream.on("error", (error: Error) => failures.push(error));

  let entryCount = 0;

  const writeLine = async (line: DryRunLine): Promise<void> => {
    const failure = failures[0];
    if (failure) throw failure;
    // One `write` call per line, so concurrent producers can interleave lines
    // but never split one.
    if (!stream.write(`${JSON.stringify(line)}\n`)) await once(stream, "drain");
  };

  await writeLine({
    kind: "header",
    generatedAt: now.toISOString(),
    environment,
  });

  return {
    path: filePath,
    async write(entry: DryRunEntry): Promise<void> {
      entryCount += 1;
      await writeLine({ kind: "patch", ...entry });
    },
    async finish(sections): Promise<DryRunSummary> {
      const summary = buildDryRunSummary(
        sections,
        entryCount,
        environment,
        now,
      );
      await writeLine(summary);
      stream.end();
      await once(stream, "close");
      const failure = failures[0];
      if (failure) throw failure;
      return summary;
    },
  };
}

/**
 * The report, or `null` on a real run — a real run keeps its concise output and
 * leaves no artifact behind. This is the single place that decision is made,
 * and `main` calls it in both modes.
 */
export async function openDryRunReport(
  options: CliOptions,
  environment: SupabaseEnvironment,
  filePath?: string,
  now: Date = new Date(),
): Promise<DryRunReportWriter | null> {
  if (!options.dryRun) return null;
  return createDryRunReport(
    filePath ?? dryRunReportPath({ projectRef: environment.projectRef, now }),
    environment,
    now,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const environment = supabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabase = createServiceClient();
  const report = await openDryRunReport(options, environment);

  const [brands, images, products, exhibitors, faq] = await Promise.all([
    ...ID_TABLES.map((config) =>
      backfillTable(supabase, config, options, report),
    ),
    backfillFaq(supabase, options, report),
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

  if (report) {
    const summary = await report.finish([
      ["brands", brands],
      ["brand_images", images],
      ["curated_products", products],
      ["event_exhibitors", exhibitors],
      ["brand_faq_entries", faq],
    ]);

    console.log(formatTermTotals(summary.terms));
    console.log("");
    console.log("Dry run complete. No changes made.");
    console.log(
      `Database: ${summary.environment.projectRef} (${summary.environment.host})`,
    );
    console.log(
      `Full diff (${summary.entryCount} patches, untruncated, one JSON object per line): ${report.path}`,
    );
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
