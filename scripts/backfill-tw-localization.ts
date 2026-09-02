/**
 * @formoria-script
 * purpose: Cleans stored zh-TW text: localizeToTW formatting plus banned-term vocabulary repair.
 * class: validator
 * invoke: pnpm backfill:tw
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { fixBannedTerms } from "../src/lib/i18n/banned-terms";
import { localizeToTW } from "../src/lib/services/taiwan-localization";
import { artifactPath } from "./shared/artifact";
import { loadScriptTarget } from "./shared/target";

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
 * DEV-1547: the report is also the APPLY MANIFEST. A run has exactly two
 * modes, and neither of them writes anything the reviewer did not mark:
 *
 *   `--dry-run`               scan every table, write the report, write nothing
 *                             to the database;
 *   `--apply <report.ndjson>` replay the patch lines the reviewer marked
 *                             `"approve": true`, verbatim, after checking each
 *                             row still holds the text they reviewed.
 *
 * The apply-everything-it-computed mode this script used to have is gone: the
 * first production dry run proposed 15 patches of which 5 were right, and
 * all-or-none is not a decision a reviewer can make. See the apply section
 * below for why the manifest is replayed rather than recomputed.
 *
 * Run: `pnpm backfill:tw -- --dry-run` (staging by default; the target is
 * resolved by `scripts/shared/target.ts`, and `--target production` is the
 * only way to reach production).
 */

/** Rows updated per concurrent write batch. */
const BATCH_SIZE = 10;

/** Rows read per select. Must stay at or below PostgREST's `db-max-rows`. */
export const PAGE_SIZE = 500;

/** Only `from` is used, so a test double is a legitimate client here. */
export type BackfillSupabase = Pick<SupabaseClient, "from">;

/**
 * The two things this script can be asked to do.
 *
 * There is no third mode, and in particular no "apply everything it finds":
 * that mode existed until DEV-1547 E1 and is what made the first production run
 * unusable — 15 patches were proposed, 5 were right, and the CLI could only
 * take all 15 or none. A write now happens ONLY by replaying an approved
 * manifest, so the set of rows a run touches is a file a human edited.
 */
export type CliOptions =
  { mode: "dry-run" } | { mode: "apply"; manifestPath: string };

/**
 * How a report entry's `before` / `after` map back onto the column.
 *
 * `text` is a text column, replayed verbatim. `json` is a jsonb column, whose
 * only textual form is `JSON.stringify` — carried on the entry so the apply
 * pass knows to parse `after` back into an object instead of writing the
 * stringified form into jsonb as a string.
 */
export type ValueEncoding = "text" | "json";

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
};

export type CuratedProductRow = {
  id: string;
  name_zh: string | null;
  product_description_zh: string | null;
};

export type ExhibitorRow = {
  id: string;
  summary_zh: string | null;
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
  /** Whether `before` / `after` are the column's text, or stringified jsonb. */
  encoding: ValueEncoding;
  /** The banned terms that fired IN THIS FIELD, with per-occurrence counts. */
  terms: TermCount[];
  /**
   * The reviewer's decision, and the ONLY thing that makes this patch eligible
   * to be written. Absent when the report is produced: a dry run approves
   * nothing, so an unedited manifest applies nothing.
   *
   * Opt-in rather than delete-the-lines-you-reject, so the artifact the
   * reviewer approved still records what they turned down. Any value other than
   * `true` or absent is rejected by `parseManifest` rather than read as "no" —
   * a typo must not silently drop a patch the reviewer meant to apply.
   */
  approve?: boolean;
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

/**
 * What one table's scan found. `updated` is the number of ROWS that would be
 * rewritten; `terms` are the banned terms behind them, merged per term.
 *
 * There is no mode flag on this any more: a scan never writes, so there is no
 * second shape it can return.
 */
export type BackfillCounts = {
  updated: number;
  terms: TermCount[];
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

/**
 * `--dry-run` or `--apply <manifest.ndjson>`, and never both or neither.
 *
 * A bare invocation is an ERROR rather than a default, in either direction: a
 * default of dry-run would make `--apply` look optional, and a default of apply
 * is the DEV-1547 E1 defect itself. The operator states which one they mean.
 */
export function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes("--dry-run");
  const applyIndex = argv.indexOf("--apply");
  const manifestPath = applyIndex >= 0 ? argv[applyIndex + 1] : undefined;

  if (dryRun && applyIndex >= 0) {
    throw new Error("Pass either --dry-run or --apply <manifest>, not both");
  }
  if (applyIndex >= 0) {
    if (!manifestPath || manifestPath.startsWith("--")) {
      throw new Error("--apply needs the path of a reviewed dry-run report");
    }
    return { mode: "apply", manifestPath };
  }
  if (dryRun) return { mode: "dry-run" };

  throw new Error(
    "Nothing to do. Run --dry-run first, approve patches in the report, then --apply <report>",
  );
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
  return rows.flatMap((_image) => {
    // No localizable text columns remain on brand_images.
    return [];
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
      // Taken from the value the patch would WRITE, which is the value the
      // apply pass has to reconstruct from this line.
      encoding: typeof after === "string" ? "text" : "json",
      terms,
    });
  }
}

function sortedTerms(accumulator: DryRunAccumulator): TermCount[] {
  return [...accumulator.terms.values()].sort((a, b) => b.count - a.count);
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
  select: "id",
  textColumns: [],
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
  select: "id, summary_zh",
  textColumns: ["summary_zh"],
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
 * Read → patch → REPORT one `id`-keyed table. This function never writes.
 *
 * The write it used to carry when `--dry-run` was absent applied every patch it
 * had just computed, which is the DEV-1547 E1 defect: a reviewer who wanted 5
 * of 15 patches had no way to ask for 5. Writing now happens only in
 * `applyApproved`, from a manifest a human edited — so "scan" and "write" are
 * separate functions reading separate inputs, not one function with a flag.
 */
export async function scanTable(
  supabase: BackfillSupabase,
  config: IdTableConfig,
  sink: DryRunEntrySink | null = null,
): Promise<BackfillCounts> {
  const accumulator = createDryRunAccumulator();
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
    },
  );

  return { updated, terms: sortedTerms(accumulator) };
}

/**
 * `brand_faq_entries` keeps its own scan: its primary key is the composite
 * `(brand_id, preset_id, position)`, so both the page ordering and the update
 * predicate take three columns instead of one. Folding it into the generic
 * `IdTableConfig` would mean parameterising the key everywhere to save four
 * lines here.
 */
export async function scanFaq(
  supabase: BackfillSupabase,
  sink: DryRunEntrySink | null = null,
): Promise<BackfillCounts> {
  const accumulator = createDryRunAccumulator();
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
    },
  );

  return { updated, terms: sortedTerms(accumulator) };
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
    addTermCounts(terms, counts.terms);
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
  if (options.mode !== "dry-run") return null;
  return createDryRunReport(
    filePath ?? dryRunReportPath({ projectRef: environment.projectRef, now }),
    environment,
    now,
  );
}

/**
 * ------------------------------------------------------------------------
 * Apply from an approved manifest (DEV-1547 E1 + E2)
 * ------------------------------------------------------------------------
 *
 * The reviewer opens the NDJSON report and, on each `patch` line they accept,
 * adds `"approve": true`. `--apply <report>` then replays THOSE LINES and
 * nothing else. That single mechanism answers both escalations:
 *
 *   E1 (apply-all-or-none): the applied set is a subset the human chose, and it
 *   is durable and reviewable — a file they edited and can re-read, diff and
 *   keep, not an id list retyped into argv.
 *
 *   E2 (approved diff not bound to applied diff): the value written is the
 *   `after` STRING from the manifest, never a value recomputed from today's row
 *   against today's term list. A prune of the term list, or a formatting fix,
 *   landing between review and apply therefore cannot change what is written.
 *
 * Chosen over the alternative the ticket names — recompute the patch and gate
 * it on a per-row content hash — because a hash proves the row did not move but
 * still writes a value nobody read, and it needs a second artifact (the hash
 * list) kept beside the report anyway. The manifest IS the precondition: it
 * carries the full `before` text, untruncated, which is strictly stronger than
 * a digest of it and needs no extra file.
 *
 * The precondition is checked in a pass of its own BEFORE the first write, and
 * any drift fails the whole run: a half-applied manifest is the one outcome a
 * reviewer cannot reason about afterwards.
 *
 * CEILING: verification reads one row per approved row, unpaged and unbatched,
 * and the gap between that read and the update is not transactional. Both are
 * sized for a human-approved manifest — tens of rows, and a gap of milliseconds
 * against a review window of hours. To replay thousands of rows, move the
 * precondition into the UPDATE itself as an `.eq(column, before)` filter with
 * `.select()` to count affected rows, which closes the gap entirely; that is
 * not done here because jsonb equality through PostgREST is untested in this
 * repo and `brands.reputation_summary` is jsonb.
 */

/** One approved patch line: what to write, and what must still be there. */
export type ApprovedEntry = {
  table: string;
  key: Record<string, string | number>;
  field: string;
  before: string;
  after: string;
  encoding: ValueEncoding;
};

/** What `--apply` was handed, before anything is read from the database. */
export type ManifestReview = {
  /** The header line's environment, or `null` if the file carries no header. */
  environment: SupabaseEnvironment | null;
  /** Every `patch` line, approved or not — the denominator the operator sees. */
  totalPatches: number;
  approved: ApprovedEntry[];
};

/** A row that no longer matches what the reviewer approved. */
export type ApplyConflict = {
  table: string;
  key: Record<string, string | number>;
  field: string;
  reason: "row_missing" | "row_ambiguous" | "value_changed";
};

export type ApplyResult = {
  /** Fields written. */
  applied: number;
  /** Rows written, per table. */
  rowsByTable: Record<string, number>;
};

function manifestError(line: number, detail: string): Error {
  return new Error(`Manifest line ${line}: ${detail}`);
}

function readKey(
  value: unknown,
  line: number,
): Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw manifestError(line, "patch has no key object");
  }
  const key: Record<string, string | number> = {};
  for (const [column, entry] of Object.entries(value)) {
    if (typeof entry !== "string" && typeof entry !== "number") {
      throw manifestError(
        line,
        `key column ${column} is neither text nor a number`,
      );
    }
    key[column] = entry;
  }
  if (Object.keys(key).length === 0) {
    throw manifestError(line, "patch key is empty");
  }
  return key;
}

/**
 * Read a reviewed report.
 *
 * Every malformed line THROWS rather than being skipped. A manifest is the
 * operator's statement of intent about production text; silently ignoring a
 * line they edited by hand is the failure this mechanism exists to prevent.
 */
export function parseManifest(contents: string): ManifestReview {
  let environment: SupabaseEnvironment | null = null;
  let totalPatches = 0;
  const approved: ApprovedEntry[] = [];

  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim();
    if (raw.length === 0) continue;
    const lineNumber = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw manifestError(lineNumber, "not valid JSON");
    }
    if (!parsed || typeof parsed !== "object") {
      throw manifestError(lineNumber, "not a JSON object");
    }
    const line = parsed as Record<string, unknown>;

    if (line.kind === "header") {
      environment = (line.environment as SupabaseEnvironment) ?? null;
      continue;
    }
    if (line.kind !== "patch") continue;

    totalPatches += 1;
    // Anything but `true` or absent: the reviewer wrote something the format
    // does not define, and guessing which way they meant it is not a decision
    // this script gets to make.
    if (line.approve !== undefined && line.approve !== true) {
      throw manifestError(
        lineNumber,
        "approve must be true or absent, and nothing else",
      );
    }
    if (line.approve !== true) continue;

    const { table, field, before, after, encoding } = line;
    if (typeof table !== "string" || table.length === 0) {
      throw manifestError(lineNumber, "patch has no table");
    }
    if (typeof field !== "string" || field.length === 0) {
      throw manifestError(lineNumber, "patch has no field");
    }
    if (typeof before !== "string" || typeof after !== "string") {
      throw manifestError(lineNumber, "patch before/after must both be text");
    }
    if (encoding !== "text" && encoding !== "json") {
      throw manifestError(lineNumber, "patch encoding must be text or json");
    }

    approved.push({
      table,
      key: readKey(line.key, lineNumber),
      field,
      before,
      after,
      encoding,
    });
  }

  return { environment, totalPatches, approved };
}

/**
 * Refuse a manifest produced against a different database.
 *
 * Both `.env.local` and `.env.staging` point at staging and production
 * credentials arrive separately, so this comparison is the only thing standing
 * between "reviewed on staging" and "applied to production".
 */
export function assertSameEnvironment(
  manifest: SupabaseEnvironment | null,
  current: SupabaseEnvironment,
): void {
  if (!manifest) {
    throw new Error(
      "Manifest has no header line, so the database it describes is unknown",
    );
  }
  if (
    manifest.projectRef !== current.projectRef ||
    manifest.host !== current.host
  ) {
    throw new Error(
      `Manifest was produced against ${manifest.projectRef} (${manifest.host}), but this run is connected to ${current.projectRef} (${current.host})`,
    );
  }
}

/** The value to write back into the column, decoded per its encoding. */
function decodeValue(entry: ApprovedEntry): unknown {
  if (entry.encoding === "text") return entry.after;
  try {
    return JSON.parse(entry.after) as unknown;
  } catch {
    throw new Error(
      `Approved patch for ${entry.table}.${entry.field} is not valid JSON`,
    );
  }
}

/**
 * The keyed single-row read the precondition needs, declared structurally for
 * the same reason `PagedQuery` is: the test double stays a few lines.
 */
type KeyedRead = {
  eq(column: string, value: string | number): KeyedRead;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

type KeyedUpdate = {
  eq(column: string, value: string | number): KeyedUpdate;
  then(
    resolve: (value: { error: unknown }) => void,
    reject?: (reason: unknown) => void,
  ): void;
};

/** All approved fields of one row, in one group. */
type ApprovedRow = {
  table: string;
  key: Record<string, string | number>;
  entries: ApprovedEntry[];
};

function groupByRow(entries: readonly ApprovedEntry[]): ApprovedRow[] {
  const rows = new Map<string, ApprovedRow>();
  for (const entry of entries) {
    // The key object is emitted by this script in a fixed column order, so its
    // JSON form is a stable identity without a canonicalising sort.
    const identity = `${entry.table} ${JSON.stringify(entry.key)}`;
    const existing = rows.get(identity);
    if (existing) existing.entries.push(entry);
    else
      rows.set(identity, {
        table: entry.table,
        key: entry.key,
        entries: [entry],
      });
  }
  return [...rows.values()];
}

function applyKey<T extends { eq(column: string, value: string | number): T }>(
  query: T,
  key: Record<string, string | number>,
): T {
  let out = query;
  for (const [column, value] of Object.entries(key)) {
    out = out.eq(column, value);
  }
  return out;
}

function conflictOf(entry: ApprovedEntry): Omit<ApplyConflict, "reason"> {
  return { table: entry.table, key: entry.key, field: entry.field };
}

function describeConflict(conflict: ApplyConflict): string {
  const key = Object.entries(conflict.key)
    .map(([column, value]) => `${column}=${String(value)}`)
    .join(" ");
  return `  ${conflict.table}.${conflict.field} [${key}]: ${conflict.reason}`;
}

/**
 * Verify every approved row still holds the text that was reviewed, then write.
 *
 * Two passes over the whole manifest, in that order: one drifted row aborts the
 * run before any write, so an apply is all-or-nothing and the operator's next
 * action is always "re-run the dry run", never "work out how far it got".
 */
export async function applyApproved(
  supabase: BackfillSupabase,
  entries: readonly ApprovedEntry[],
): Promise<ApplyResult> {
  const rows = groupByRow(entries);
  const conflicts: ApplyConflict[] = [];

  for (const row of rows) {
    const fields = [...new Set(row.entries.map((entry) => entry.field))];
    const query = applyKey(
      supabase
        .from(row.table)
        .select(fields.join(", ")) as unknown as KeyedRead,
      row.key,
    );
    // `limit(2)`, not `limit(1)`: a key matching more than one row means the
    // manifest's key is not the row identity it claims to be, and an update
    // issued on it would rewrite rows nobody reviewed.
    const { data, error } = await query.limit(2);
    if (error) throw error;

    const found = (data ?? []) as Record<string, unknown>[];
    if (found.length !== 1) {
      const reason = found.length === 0 ? "row_missing" : "row_ambiguous";
      for (const entry of row.entries) {
        conflicts.push({ ...conflictOf(entry), reason });
      }
      continue;
    }

    const current = found[0]!;
    for (const entry of row.entries) {
      if (toText(current[entry.field]) !== entry.before) {
        conflicts.push({ ...conflictOf(entry), reason: "value_changed" });
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      [
        `${conflicts.length} approved patch(es) no longer match the reviewed text. Nothing was written.`,
        ...conflicts.map(describeConflict),
        "Re-run --dry-run and review the current text.",
      ].join("\n"),
    );
  }

  const rowsByTable: Record<string, number> = {};
  let applied = 0;

  await inBatches(rows, async (row) => {
    const patch: Record<string, unknown> = {};
    for (const entry of row.entries) patch[entry.field] = decodeValue(entry);

    const update = applyKey(
      supabase.from(row.table).update(patch) as unknown as KeyedUpdate,
      row.key,
    );
    const { error } = await update;
    if (error) throw error;

    rowsByTable[row.table] = (rowsByTable[row.table] ?? 0) + 1;
    applied += row.entries.length;
  });

  return { applied, rowsByTable };
}

/** Read, check, and replay a reviewed manifest. */
export async function runApply(
  supabase: BackfillSupabase,
  environment: SupabaseEnvironment,
  manifestPath: string,
): Promise<ApplyResult> {
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  assertSameEnvironment(manifest.environment, environment);

  if (manifest.approved.length === 0) {
    throw new Error(
      `No patch in ${manifestPath} carries "approve": true (${manifest.totalPatches} patches in the file). Nothing to apply.`,
    );
  }

  const result = await applyApproved(supabase, manifest.approved);
  console.log(
    `Applied ${result.applied} of ${manifest.totalPatches} patches from ${manifestPath}`,
  );
  console.log(`Database: ${environment.projectRef} (${environment.host})`);
  for (const [table, count] of Object.entries(result.rowsByTable)) {
    console.log(`  ${table}: ${count} rows`);
  }
  return result;
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const options = parseArgs(argv);
  const environment = supabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabase = createServiceClient();

  if (options.mode === "apply") {
    await runApply(supabase, environment, options.manifestPath);
    return;
  }

  const report = await openDryRunReport(options, environment);

  const [brands, images, products, exhibitors, faq] = await Promise.all([
    ...ID_TABLES.map((config) => scanTable(supabase, config, report)),
    scanFaq(supabase, report),
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
    console.log(
      'Review it, add "approve": true to each patch line you accept, then:',
    );
    console.log(`  pnpm backfill:tw -- --apply ${report.path}`);
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
