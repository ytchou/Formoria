import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_NOTE } from "@/lib/validation/curated-product";
import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget, type ScriptTarget } from "../../../shared/target";
import { STAGING_REVALIDATION_SKIPPED } from "./normalize-names";
import { assertRevalidationConfigured, fetchAllRows, parseApplyOption } from "./shared";

/**
 * Fills a missing `curated_products.product_description_en` with a faithful
 * translation of the stored `product_description_zh` (DEV-2016).
 *
 * TRANSLATION ONLY. The Chinese description is the input, never something this
 * script rewrites, shortens, or "improves". Nothing but the one EN column is
 * ever written, and only where it is empty.
 *
 * Three steps, a human between the second and the third:
 *
 *   1. generate — reads the rows, asks Claude for translations in batches,
 *      writes a manifest. NO database write.
 *        pnpm exec tsx scripts/enrichment/products/curated-products/translate-descriptions-en.ts generate
 *        …--out=<path>         manifest path (default translate-descriptions-en-<target>-<ts>.json)
 *        …--resume             keep the entries already in --out, translate the rest
 *        …--brand=<slug>       one brand only
 *        …--limit=<n>          at most n rows (a sample)
 *        …--batch-size=<n>     rows per model call (default 20)
 *        …--concurrency=<n>    model calls in flight (default 3)
 *
 *   2. review — a person reads the manifest and sets `review` on each entry to
 *      "approved" or "rejected". They may edit `proposedEn` before approving.
 *      Entries with `status: "exception"` are held for an editorial decision;
 *      approving one requires writing a `proposedEn` for it by hand.
 *
 *   3. apply — dry run by default.
 *        pnpm exec tsx scripts/enrichment/products/curated-products/translate-descriptions-en.ts apply --manifest=<path>
 *        …--apply              write the approved entries
 *        …--target=production  defaults to staging; must match the manifest's target
 *
 * PRECONDITIONS, CHECKED FRESH AT APPLY: the row still exists and is visible,
 * its EN description is still empty, and its zh description hashes to the
 * value the translation was made from. Any drift skips the row and says why —
 * a zh text edited since generation would otherwise get a translation of words
 * it no longer contains.
 *
 * ROLLBACK: every written row had an empty EN description before, so restoring
 * one is `updateCuratedProduct(id, { productDescriptionEn: null })`. The apply
 * run prints each written id.
 *
 * MODEL: `claude -p` on the logged-in subscription, never an API key and never
 * `--bare` (bare mode needs one). No tools, no MCP servers, no settings, no
 * session persistence — the call sees only the batch it is given.
 *
 * SCOPE: visible curated products of every brand. A hidden row is the record
 * of a rejection (see proposal-diff.ts), so it gets no copy work.
 */

export const MODEL = "claude-opus-5-5";
const PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;
/** One batch of 20 takes about a minute; this is the stall ceiling, not the norm. */
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** CJK Unified Ideographs (and Extension A). Translated English must carry none. */
const HAN = /[㐀-䶿一-鿿]/u;

export type DescriptionRow = {
  id: string;
  brand_id: string;
  name_zh: string;
  name_en: string | null;
  product_description_zh: string;
  product_description_en: string | null;
  visible: boolean;
  brands?: { slug: string } | { slug: string }[] | null;
};

export type ManifestEntry = {
  id: string;
  brandSlug: string | null;
  nameZh: string;
  nameEn: string | null;
  sourceZh: string;
  /** sha256 of `sourceZh`; apply refuses a row whose zh no longer matches. */
  sourceZhSha256: string;
  proposedEn: string | null;
  /** `exception` is held for an editorial decision; `exception` says why. */
  status: "proposed" | "exception";
  exception: string | null;
  /** Set by a person. Only "approved" is ever written. */
  review: "pending" | "approved" | "rejected";
};

export type Manifest = {
  ticket: "DEV-2016";
  target: ScriptTarget;
  generatedAt: string;
  model: string;
  scope: {
    table: "curated_products";
    writes: "product_description_en";
    selection: string;
  };
  entries: ManifestEntry[];
};

export const SCOPE_SELECTION =
  "visible = true AND trim(coalesce(product_description_en, '')) = ''";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** PostgREST returns a to-one embed as an object here and an array elsewhere. */
function brandSlugOf(row: DescriptionRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/** Blank counts as missing: tile-fields.ts falls back on `??`, so "" renders empty. */
export function isMissingEn(value: string | null): boolean {
  return (value ?? "").trim() === "";
}

/** Pure: the rows this backfill may touch, in input order. */
export function selectMissing(rows: readonly DescriptionRow[]): DescriptionRow[] {
  return rows.filter(
    (row) =>
      row.visible &&
      isMissingEn(row.product_description_en) &&
      row.product_description_zh.trim() !== "",
  );
}

export const SYSTEM_PROMPT = `You translate Traditional Chinese (Taiwan) product descriptions into English for a curated catalog of Taiwanese goods.

Rules, in priority order:
1. Faithful. Translate what the Chinese says: every fact and claim, nothing added, nothing dropped, nothing strengthened or softened. Do not add praise, adjectives, or selling language the source does not contain ("perfect", "beautifully", "must-have"). Do not summarise or shorten.
2. Natural English. Plain, specific sentences a careful editor would write. Keep the source's sentence order and paragraph breaks.
3. Names. Use the given English product name where one is supplied. Romanise Taiwanese place names in standard Taiwan usage (Tainan, Hualien, Yilan). Keep brand names as Latin text if the source gives one; otherwise romanise. The output must contain no Chinese characters.
4. Units, numbers, materials, and sizes stay exactly as written.

When you cannot translate an item faithfully — the source is truncated or garbled, is not a product description, or makes a claim whose meaning is too ambiguous to render without guessing — return an exception for that item instead of a translation, with a one-sentence reason. Never guess.

Return exactly one result per input id.`;

/** The JSON schema `claude -p --json-schema` enforces on each batch. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          en: { type: "string" },
          exception: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  required: ["items"],
} as const;

export function buildBatchPrompt(rows: readonly DescriptionRow[]): string {
  const items = rows.map((row) => ({
    id: row.id,
    product_name_zh: row.name_zh,
    product_name_en: row.name_en,
    description_zh: row.product_description_zh,
  }));
  return `Translate description_zh of each item into English. For each item return {"id", "en"} or {"id", "exception"}.\n\n${JSON.stringify(items, null, 2)}`;
}

type ModelItem = { id?: unknown; en?: unknown; exception?: unknown };

/**
 * Pure: one manifest entry per row of the batch, from the model's structured
 * output. A missing, empty, Han-bearing, or over-long translation becomes an
 * exception rather than a proposal, so nothing malformed reaches review as if
 * it were ordinary.
 */
export function entriesFromModel(
  rows: readonly DescriptionRow[],
  output: { items?: readonly ModelItem[] } | null,
): ManifestEntry[] {
  const byId = new Map<string, ModelItem>();
  for (const item of output?.items ?? []) {
    if (typeof item.id === "string") byId.set(item.id, item);
  }

  return rows.map((row) => {
    const item = byId.get(row.id);
    const en = typeof item?.en === "string" ? item.en.trim() : "";
    const modelException =
      typeof item?.exception === "string" && item.exception.trim()
        ? item.exception.trim()
        : null;

    let exception: string | null = null;
    if (!item) exception = "model returned no result for this id";
    else if (modelException) exception = `model: ${modelException}`;
    else if (!en) exception = "model returned an empty translation";
    else if (HAN.test(en)) exception = "translation contains Chinese characters";
    else if (en.length > MAX_NOTE) exception = `translation exceeds ${MAX_NOTE} characters`;

    return {
      id: row.id,
      brandSlug: brandSlugOf(row),
      nameZh: row.name_zh,
      nameEn: row.name_en,
      sourceZh: row.product_description_zh,
      sourceZhSha256: sha256(row.product_description_zh),
      proposedEn: en || null,
      status: exception ? "exception" : "proposed",
      exception,
      review: "pending",
    };
  });
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export type SkipReason =
  | "not-approved"
  | "no-proposed-en"
  | "row-missing"
  | "row-hidden"
  | "en-already-set"
  | "zh-changed";

/** Pure: whether one reviewed entry may be written against the row as it is now. */
export function checkPrecondition(
  entry: ManifestEntry,
  current: DescriptionRow | undefined,
): SkipReason | null {
  if (entry.review !== "approved") return "not-approved";
  if (!entry.proposedEn?.trim()) return "no-proposed-en";
  if (!current) return "row-missing";
  if (!current.visible) return "row-hidden";
  if (!isMissingEn(current.product_description_en)) return "en-already-set";
  if (sha256(current.product_description_zh) !== entry.sourceZhSha256) {
    return "zh-changed";
  }
  return null;
}

/** The service write, injected so the test never mocks `@/lib/services/`. */
export type UpdateDescriptionEn = (id: string, en: string) => Promise<void>;

export type ApplyReport = {
  intended: number;
  written: number;
  writtenIds: string[];
  writtenBrandSlugs: string[];
  skipped: Record<SkipReason, number>;
  failures: string[];
};

/**
 * Sequential on purpose, like normalize-names.ts: a few hundred single-row
 * updates finish in seconds and keep the audit trail in output order.
 *
 * The precondition read happens once, before the loop, not per row: a zh edit
 * that lands between that read and the write is not caught. Acceptable for a
 * one-shot backfill run while nobody is editing; a conditional UPDATE in the
 * service would close the window if this ever runs unattended.
 */
export async function applyEntries({
  entries,
  current,
  apply,
  update,
}: {
  entries: readonly ManifestEntry[];
  current: ReadonlyMap<string, DescriptionRow>;
  apply: boolean;
  update: UpdateDescriptionEn;
}): Promise<ApplyReport> {
  const skipped: Record<SkipReason, number> = {
    "not-approved": 0,
    "no-proposed-en": 0,
    "row-missing": 0,
    "row-hidden": 0,
    "en-already-set": 0,
    "zh-changed": 0,
  };
  const ready: ManifestEntry[] = [];
  for (const entry of entries) {
    const reason = checkPrecondition(entry, current.get(entry.id));
    if (reason) skipped[reason] += 1;
    else ready.push(entry);
  }

  const report: ApplyReport = {
    intended: ready.length,
    written: 0,
    writtenIds: [],
    writtenBrandSlugs: [],
    skipped,
    failures: [],
  };
  if (!apply) return report;

  const slugs = new Set<string>();
  for (const entry of ready) {
    try {
      await update(entry.id, (entry.proposedEn ?? "").trim());
      report.written += 1;
      report.writtenIds.push(entry.id);
      if (entry.brandSlug) slugs.add(entry.brandSlug);
    } catch (error: unknown) {
      // Counted and carried, never thrown: one failed row must not end a run
      // that has already written an arbitrary prefix of the rest.
      report.failures.push(
        `${entry.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  report.writtenBrandSlugs = [...slugs].sort();
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(argv: readonly string[], flag: string): string | null {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    const value = inline.slice(flag.length + 1);
    if (!value) throw new Error(`${flag} requires a value`);
    return value;
  }
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv.at(index + 1);
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInt(argv: readonly string[], flag: string, fallback: number | null) {
  const raw = argValue(argv, flag);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

async function loadRows(brandSlug: string | null): Promise<DescriptionRow[]> {
  const supabase = createServiceClient();
  return fetchAllRows<DescriptionRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select(
          "id, brand_id, name_zh, name_en, product_description_zh, product_description_en, visible, brands!inner(slug)",
        );
      if (brandSlug) query = query.eq("brands.slug", brandSlug);
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

let emptyMcpConfig: string | null = null;

/** One `claude -p` call on the subscription login; resolves the structured output. */
function callClaude(prompt: string): Promise<{ items?: ModelItem[] } | null> {
  emptyMcpConfig ??= (() => {
    const path = join(mkdtempSync(join(tmpdir(), "dev-2016-")), "mcp.json");
    writeFileSync(path, '{"mcpServers":{}}');
    return path;
  })();
  const args = [
    "-p",
    "--model",
    MODEL,
    "--system-prompt",
    SYSTEM_PROMPT,
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    emptyMcpConfig,
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(RESPONSE_SCHEMA),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${CALL_TIMEOUT_MS} ms`));
    }, CALL_TIMEOUT_MS);
    child.stdout.on("data", (data: Buffer) => (stdout += data.toString()));
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          is_error?: boolean;
          structured_output?: { items?: ModelItem[] };
          result?: string;
        };
        if (parsed.is_error) {
          reject(new Error(`claude -p error: ${String(parsed.result).slice(0, 500)}`));
          return;
        }
        resolve(parsed.structured_output ?? null);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(prompt);
  });
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function counts(entries: readonly ManifestEntry[]) {
  return {
    entries: entries.length,
    proposed: entries.filter((entry) => entry.status === "proposed").length,
    exceptions: entries.filter((entry) => entry.status === "exception").length,
  };
}

async function generate(target: ScriptTarget, argv: readonly string[]): Promise<void> {
  const out =
    argValue(argv, "--out") ??
    `translate-descriptions-en-${target}-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const resume = argv.includes("--resume");
  const brandSlug = argValue(argv, "--brand");
  const limit = positiveInt(argv, "--limit", null);
  const batchSize = positiveInt(argv, "--batch-size", DEFAULT_BATCH_SIZE) ?? DEFAULT_BATCH_SIZE;
  const concurrency =
    positiveInt(argv, "--concurrency", DEFAULT_CONCURRENCY) ?? DEFAULT_CONCURRENCY;

  const manifest: Manifest =
    resume && existsSync(out)
      ? readManifest(out)
      : {
          ticket: "DEV-2016",
          target,
          generatedAt: new Date().toISOString(),
          model: MODEL,
          scope: {
            table: "curated_products",
            writes: "product_description_en",
            selection: SCOPE_SELECTION,
          },
          entries: [],
        };
  if (manifest.target !== target) {
    throw new Error(`--resume: manifest is for ${manifest.target}, not ${target}`);
  }

  const rows = await loadRows(brandSlug);
  const missing = selectMissing(rows);
  const done = new Set(manifest.entries.map((entry) => entry.id));
  let todo = missing.filter((row) => !done.has(row.id));
  if (limit !== null) todo = todo.slice(0, limit);

  console.log(
    JSON.stringify({
      mode: "generate",
      out,
      brand: brandSlug,
      selected: rows.length,
      visible: rows.filter((row) => row.visible).length,
      missingEn: missing.length,
      alreadyInManifest: done.size,
      toTranslate: todo.length,
      batches: Math.ceil(todo.length / batchSize),
    }),
  );

  const batches = chunk(todo, batchSize);
  let next = 0;
  let failedBatches = 0;
  // Workers pull the next batch; the manifest is rewritten after each one, so
  // an interrupted run resumes with --resume and loses at most the batches in flight.
  async function worker(): Promise<void> {
    while (next < batches.length) {
      const index = next;
      next += 1;
      const batch = batches[index];
      try {
        const output = await callClaude(buildBatchPrompt(batch));
        manifest.entries.push(...entriesFromModel(batch, output));
        writeManifest(out, manifest);
        console.log(
          JSON.stringify({ batch: index + 1, of: batches.length, ...counts(manifest.entries) }),
        );
      } catch (error: unknown) {
        // Not written to the manifest: --resume picks these rows up again.
        failedBatches += 1;
        console.error(
          JSON.stringify({
            batchFailed: index + 1,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  writeManifest(out, manifest);

  console.log(JSON.stringify({ manifest: out, ...counts(manifest.entries), failedBatches }));
  if (failedBatches > 0) process.exitCode = 1;
  console.log(
    "No database writes. Review the manifest (set review to approved/rejected), then run apply --manifest=<path>.",
  );
}

async function applyManifest(target: ScriptTarget, argv: readonly string[]): Promise<void> {
  const path = argValue(argv, "--manifest");
  if (!path) throw new Error("apply requires --manifest=<path>");
  const apply = parseApplyOption(argv);
  const manifest = readManifest(path);
  if (manifest.target !== target) {
    throw new Error(
      `manifest was generated against ${manifest.target}; refusing to apply it to ${target}`,
    );
  }
  // Staging has no revalidation route — see normalize-names.ts.
  const revalidate = target !== "staging";
  if (apply && revalidate) assertRevalidationConfigured();

  const rows = await loadRows(null);
  const current = new Map(rows.map((row) => [row.id, row]));
  const { updateCuratedProduct } = await import("@/lib/services/curated-products");
  const report = await applyEntries({
    entries: manifest.entries,
    current,
    apply,
    update: (id, en) => updateCuratedProduct(id, { productDescriptionEn: en }),
  });

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      manifest: path,
      ...counts(manifest.entries),
      approved: manifest.entries.filter((entry) => entry.review === "approved").length,
      intended: report.intended,
      written: report.written,
      skipped: report.skipped,
      failures: report.failures.length,
    }),
  );
  for (const id of report.writtenIds) console.log(JSON.stringify({ written: id }));
  for (const failure of report.failures) console.log(JSON.stringify({ failed: failure }));
  if (report.failures.length > 0) process.exitCode = 1;

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }
  if (report.written === 0) return;
  if (!revalidate) {
    console.log(JSON.stringify(STAGING_REVALIDATION_SKIPPED));
    return;
  }
  const { requestPublicBrandRevalidation } = await import("@/lib/cache/revalidate-client");
  const revalidation = await requestPublicBrandRevalidation(report.writtenBrandSlugs);
  console.log(
    JSON.stringify({
      revalidated: report.writtenBrandSlugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  );
  if (!revalidation.ok) {
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

async function main(): Promise<void> {
  const { target, argv } = loadScriptTarget();
  const [command, ...rest] = argv;
  if (command === "generate") return generate(target, rest);
  if (command === "apply") return applyManifest(target, rest);
  throw new Error("usage: translate-descriptions-en.ts <generate|apply> [options]");
}

// The test imports the pure functions, so importing must never start a run.
if (process.argv[1]?.endsWith("curated-products/translate-descriptions-en.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
