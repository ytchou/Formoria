/**
 * Plan and apply a reviewed product-tag normalization run for approved brands.
 *
 * Planning is the default and never mutates Supabase. It resolves ontology
 * aliases deterministically, asks DeepSeek only for the remaining labels, and
 * writes a timestamped JSON artifact with paired before/after values and a
 * restoration snapshot. Applying a plan requires an explicitly supplied,
 * manually reviewed artifact; it never calls the model again.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/normalize-product-tags.ts
 *   pnpm exec tsx --env-file=.env.local scripts/normalize-product-tags.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/normalize-product-tags.ts \
 *     --apply --artifact=scripts/eval/results/normalize-product-tags-<timestamp>.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { ChatAuditEvent } from "@/lib/audit";
import {
  createDeepSeekClient,
  parseDeepSeekJson,
} from "@/lib/services/deepseek-client";
import {
  planTagBackfill,
  normalizeProductTags,
} from "@/lib/services/product-tags";
import { updateBrand } from "@/lib/services/brands";
import {
  PRODUCT_SUBCATEGORIES,
  type ProductSubcategory,
} from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_TAGS = 5;
export const DISTINCT_AFTER_THRESHOLD = 350;
export const RUN_ARTIFACT_VERSION = 2;
export const PRESERVED_TAGS = [
  "食品禮盒",
  "客製化禮品",
  "體驗課程・DIY材料",
  "彌月禮盒",
] as const;

const PRESERVED_TAG_SET = new Set<string>(PRESERVED_TAGS);
const ARTIFACT_KIND = "normalize-product-tags" as const;
export const PLANNING_OPERATION = "normalize-product-tags.map-tags" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CliOptions = {
  apply: boolean;
  dryRun: boolean;
  batchSize: number;
  artifactPath: string | null;
};

export type BrandRow = {
  id: string;
  slug: string;
  status: string;
  product_type: string | null;
  product_tags: string[] | null;
  product_tags_en: string[] | null;
};

export type TagSource = "matched" | "llm" | "novel" | "preserved" | "dropped";

type PairWithSource = {
  zh: string;
  en: string;
  originalTag: string;
  source: Exclude<TagSource, "dropped">;
};

export type BrandResult = {
  brand: BrandRow;
  beforeZh: string[];
  beforeEn: string[] | null;
  afterZh: string[];
  afterEn: string[];
  perTagSource: Map<string, TagSource>;
};

export type TagPair = {
  zh: string;
  en: string | null;
};

export type RunSummary = {
  brandsScanned: number;
  brandsChanged: number;
  distinctBefore: number;
  distinctAfter: number;
  totalOriginalTags: number;
  mappedCount: number;
  droppedCount: number;
  pctMapped: string;
  preservedTagCounts: Record<
    (typeof PRESERVED_TAGS)[number],
    { before: number; after: number }
  >;
  productTypeTotals: Record<string, number>;
};

export type PlanningCall = {
  category: string;
  operation: typeof PLANNING_OPERATION;
};

type ArtifactReview = {
  status: "pending" | "approved";
  reviewer: string | null;
  reviewedAt: string | null;
};

type ArtifactValue = {
  productTags: string[];
  productTagsEn: string[] | null;
  pairs: TagPair[];
};

type ArtifactRow = {
  id: string;
  slug: string;
  status: string;
  productType: string | null;
  before: ArtifactValue;
  after: ArtifactValue & { productTagsEn: string[] };
  sources: Record<string, TagSource>;
};

type RollbackRow = {
  id: string;
  slug: string;
  productTags: string[];
  productTagsEn: string[] | null;
};

export type RunArtifact = {
  version: typeof RUN_ARTIFACT_VERSION;
  kind: typeof ARTIFACT_KIND;
  createdAt: string;
  planningCalls: PlanningCall[];
  auditEvents: ChatAuditEvent[];
  review: ArtifactReview;
  summary: RunSummary;
  rows: ArtifactRow[];
  rollback: {
    strategy: "restore-before-values";
    rows: RollbackRow[];
  };
};

// ---------------------------------------------------------------------------
// Module-level lookups (computed once)
// ---------------------------------------------------------------------------

const slugToSub = new Map<string, ProductSubcategory>();
for (const sub of PRODUCT_SUBCATEGORIES) {
  slugToSub.set(sub.slug, sub);
}

const categorySubcategories = new Map<string, ProductSubcategory[]>();
for (const sub of PRODUCT_SUBCATEGORIES) {
  const list = categorySubcategories.get(sub.category) ?? [];
  list.push(sub);
  categorySubcategories.set(sub.category, list);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): CliOptions {
  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  const batchSizeArg = argv.find((arg) => arg.startsWith("--batch-size="));
  const artifactArg = argv.find((arg) => arg.startsWith("--artifact="));
  const knownFlags = new Set(["--apply", "--dry-run"]);
  const unknown = argv.filter(
    (arg) =>
      !knownFlags.has(arg) &&
      !arg.startsWith("--batch-size=") &&
      !arg.startsWith("--artifact="),
  );

  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  }

  if (apply && dryRunFlag) {
    throw new Error("--apply and --dry-run cannot be combined");
  }

  const batchSize = batchSizeArg
    ? Number(batchSizeArg.slice("--batch-size=".length))
    : 50;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }

  const artifactPath = artifactArg
    ? artifactArg.slice("--artifact=".length).trim()
    : null;
  if (artifactArg && !artifactPath) {
    throw new Error("--artifact must include a file path");
  }
  if (artifactPath && !apply) {
    throw new Error("--artifact is only valid with --apply");
  }
  if (apply && !artifactPath) {
    throw new Error("--apply requires an explicit --artifact=<path>");
  }

  return {
    apply,
    dryRun: !apply,
    batchSize,
    artifactPath,
  };
}

// ---------------------------------------------------------------------------
// Supabase boundary
// ---------------------------------------------------------------------------

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient(url, serviceRoleKey);
}

type SupabaseClient = ReturnType<typeof createServiceClient>;

async function loadApprovedBrands(
  supabase: SupabaseClient,
  batchSize: number,
): Promise<BrandRow[]> {
  const brands: BrandRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug, status, product_type, product_tags, product_tags_en")
      .eq("status", "approved")
      .not("product_tags", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) throw error;

    const batch = (data ?? []) as BrandRow[];
    brands.push(
      ...batch.filter((brand) => (brand.product_tags ?? []).length > 0),
    );

    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return brands;
}

async function loadBrandSnapshot(
  supabase: SupabaseClient,
  id: string,
): Promise<BrandRow> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, slug, status, product_type, product_tags, product_tags_en")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Brand ${id} no longer exists`);
  return data as BrandRow;
}

function sameArray(left: string[] | null, right: string[] | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCurrentMatchesArtifact(
  current: BrandRow,
  row: ArtifactRow,
): void {
  if (
    current.id !== row.id ||
    current.slug !== row.slug ||
    current.status !== row.status ||
    current.product_type !== row.productType ||
    !sameArray(current.product_tags, row.before.productTags) ||
    !sameArray(current.product_tags_en, row.before.productTagsEn)
  ) {
    throw new Error(
      `ABORT: baseline drift for brand "${row.slug}"; current DB values do not match the reviewed artifact`,
    );
  }
}

// ---------------------------------------------------------------------------
// LLM mapping boundary
// ---------------------------------------------------------------------------

export function createPlanningDeepSeekClient(
  auditEvents: ChatAuditEvent[],
): ReturnType<typeof createDeepSeekClient> {
  return createDeepSeekClient({
    onChatComplete: (event) => {
      auditEvents.push(event);
    },
  });
}

function collectPlanningCategories(
  entries: Array<{ category: string; unmatched: string[] }>,
): Map<string, Set<string>> {
  const categoryUnmatched = new Map<string, Set<string>>();
  for (const { category, unmatched } of entries) {
    const tags = categoryUnmatched.get(category) ?? new Set<string>();
    for (const tag of unmatched) {
      if (!PRESERVED_TAG_SET.has(tag)) tags.add(tag);
    }
    categoryUnmatched.set(category, tags);
  }
  return categoryUnmatched;
}

function planningCallsForCategories(
  categoryUnmatched: Map<string, Set<string>>,
): PlanningCall[] {
  return [...categoryUnmatched].flatMap(([category, tags]) =>
    tags.size > 0 ? [{ category, operation: PLANNING_OPERATION }] : [],
  );
}

function expectedPlanningCallsForResults(
  results: BrandResult[],
): PlanningCall[] {
  return planningCallsForCategories(
    collectPlanningCategories(
      results.map((result) => ({
        category: result.brand.product_type ?? "unknown",
        unmatched: planTagBackfill(result.beforeZh).unmatched,
      })),
    ),
  );
}

export async function mapTagsWithLlm(
  client: ReturnType<typeof createDeepSeekClient>,
  category: string,
  tags: string[],
): Promise<Map<string, string | null>> {
  if (tags.length === 0) return new Map();

  const subs = categorySubcategories.get(category) ?? [];
  const slugList = subs.map((sub) => `${sub.slug} (${sub.nameZh})`).join("\n");
  const system =
    "You are a product taxonomy assistant for Formoria, a Taiwanese brand discovery and curation platform. " +
    "Map Chinese product tags to predefined subcategory slugs. Return only valid JSON.";
  const user =
    "Map each Chinese product tag to the most fitting subcategory slug from the list below, " +
    `or null if none fits well.\n\nAvailable slugs for category "${category}":\n${slugList}\n\n` +
    "Tags to map (return a JSON object mapping each tag string to a slug string or null):\n" +
    tags.join("\n");

  const result = await client.chat({
    system,
    user,
    json: true,
    timeoutMs: 30_000,
    meta: { category, operation: PLANNING_OPERATION },
  });

  if (!result.content) {
    console.warn(
      `[llm] call failed for category "${category}" — treating all as unmatched`,
    );
    return new Map(tags.map((tag) => [tag, null]));
  }

  const mapping = parseDeepSeekJson<Record<string, string | null>>(
    result.content,
  );
  if (!mapping) {
    console.warn(
      `[llm] invalid JSON for category "${category}" — treating all as unmatched`,
    );
    return new Map(tags.map((tag) => [tag, null]));
  }

  const out = new Map<string, string | null>();
  for (const tag of tags) {
    const slug = mapping[tag];
    out.set(tag, typeof slug === "string" && slugToSub.has(slug) ? slug : null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure per-brand planning
// ---------------------------------------------------------------------------

export function composeResult(
  brand: BrandRow,
  plan: ReturnType<typeof planTagBackfill>,
  llmMapping: Map<string, string | null>,
): BrandResult {
  const beforeZh = brand.product_tags ?? [];
  const beforeEn = brand.product_tags_en;
  const zhToEn = new Map<string, string>();
  for (let index = 0; index < beforeZh.length; index += 1) {
    const zh = beforeZh[index];
    if (zh) zhToEn.set(zh, beforeEn?.[index] ?? zh);
  }

  const pairs: PairWithSource[] = [];
  const seenSlugs = new Set<string>();
  const droppedTags = new Set<string>();

  // Preserve the four retired-axis labels before any canonicalization. They
  // are research signals until DEV-1384 chooses a destination surface.
  for (let index = 0; index < beforeZh.length; index += 1) {
    const original = beforeZh[index];
    if (!PRESERVED_TAG_SET.has(original)) continue;
    pairs.push({
      zh: original,
      en: beforeEn?.[index] ?? original,
      originalTag: original,
      source: "preserved",
    });
  }

  // Pass 1 — deterministic vocab matches.
  for (const match of plan.matched) {
    if (PRESERVED_TAG_SET.has(match.original)) continue;
    if (seenSlugs.has(match.slug)) {
      droppedTags.add(match.original);
      continue;
    }
    seenSlugs.add(match.slug);
    pairs.push({
      zh: match.canonicalZh,
      en: match.canonicalEn,
      originalTag: match.original,
      source: "matched",
    });
  }

  // Pass 2 — LLM-mapped + novel heuristics. Preserved labels never reach a
  // model or a heuristic, even if a future ontology alias overlaps one.
  for (const unmatchedTag of plan.unmatched) {
    if (PRESERVED_TAG_SET.has(unmatchedTag)) continue;

    const slug = llmMapping.get(unmatchedTag);
    if (typeof slug === "string") {
      const sub = slugToSub.get(slug);
      if (sub && !seenSlugs.has(sub.slug)) {
        seenSlugs.add(sub.slug);
        pairs.push({
          zh: sub.nameZh,
          en: sub.nameEn,
          originalTag: unmatchedTag,
          source: "llm",
        });
      } else {
        droppedTags.add(unmatchedTag);
      }
      continue;
    }

    const novel = normalizeProductTags(
      [unmatchedTag],
      [zhToEn.get(unmatchedTag) ?? ""],
    );
    if (novel.tags.length > 0) {
      pairs.push({
        zh: novel.tags[0]!,
        en: novel.tagsEn[0] ?? unmatchedTag,
        originalTag: unmatchedTag,
        source: "novel",
      });
    } else {
      droppedTags.add(unmatchedTag);
    }
  }

  // Keep the existing five-tag product invariant. Preserved labels are first,
  // so a source row can only lose one of them when the input itself is unsafe.
  const capped = pairs.slice(0, MAX_TAGS);
  const cappedOriginals = new Set(capped.map((pair) => pair.originalTag));
  for (const preserved of pairs.filter((pair) => pair.source === "preserved")) {
    if (!capped.includes(preserved)) {
      throw new Error(
        `ABORT: preserved tag "${preserved.zh}" would be removed by the ${MAX_TAGS}-tag cap for brand "${brand.slug}"`,
      );
    }
  }

  const perTagSource = new Map<string, TagSource>();
  for (const pair of capped) perTagSource.set(pair.originalTag, pair.source);
  for (const tag of droppedTags) perTagSource.set(tag, "dropped");
  for (const pair of pairs.slice(MAX_TAGS)) {
    if (!cappedOriginals.has(pair.originalTag)) {
      perTagSource.set(pair.originalTag, "dropped");
    }
  }

  return {
    brand,
    beforeZh,
    beforeEn,
    afterZh: capped.map((pair) => pair.zh),
    afterEn: capped.map((pair) => pair.en),
    perTagSource,
  };
}

function toTagPairs(
  productTags: string[],
  productTagsEn: string[] | null,
): TagPair[] {
  return productTags.map((zh, index) => ({
    zh,
    en: productTagsEn?.[index] ?? null,
  }));
}

function preservedCounts(
  values: string[],
): Record<(typeof PRESERVED_TAGS)[number], number> {
  const counts = Object.fromEntries(
    PRESERVED_TAGS.map((tag) => [tag, 0]),
  ) as Record<(typeof PRESERVED_TAGS)[number], number>;
  for (const value of values) {
    if (PRESERVED_TAG_SET.has(value)) {
      counts[value as (typeof PRESERVED_TAGS)[number]] += 1;
    }
  }
  return counts;
}

function productTypeTotals(results: BrandResult[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const result of results) {
    const category = result.brand.product_type ?? "unknown";
    totals[category] = (totals[category] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function validateResults(results: BrandResult[]): RunSummary {
  const seenIds = new Set<string>();
  const beforeTags = results.flatMap((result) => result.beforeZh);
  const afterTags = results.flatMap((result) => result.afterZh);

  for (const result of results) {
    if (seenIds.has(result.brand.id)) {
      throw new Error(`ABORT: duplicate brand id "${result.brand.id}" in plan`);
    }
    seenIds.add(result.brand.id);

    if (result.beforeZh.length > 0 && result.afterZh.length === 0) {
      throw new Error(
        `ABORT: brand "${result.brand.slug}" would go from tags to zero tags`,
      );
    }
    if (result.afterZh.length > MAX_TAGS) {
      throw new Error(
        `ABORT: brand "${result.brand.slug}" exceeds the ${MAX_TAGS}-tag cap`,
      );
    }
    if (result.afterZh.length !== result.afterEn.length) {
      throw new Error(
        `ABORT: brand "${result.brand.slug}" has unpaired zh/en after values`,
      );
    }
    if (
      result.beforeEn !== null &&
      result.beforeZh.length !== result.beforeEn.length
    ) {
      throw new Error(
        `ABORT: brand "${result.brand.slug}" has unpaired zh/en before values`,
      );
    }

    const beforePreserved = preservedCounts(result.beforeZh);
    const afterPreserved = preservedCounts(result.afterZh);
    for (const tag of PRESERVED_TAGS) {
      if (beforePreserved[tag] !== afterPreserved[tag]) {
        throw new Error(
          `ABORT: preserved tag "${tag}" changed count for brand "${result.brand.slug}"`,
        );
      }
    }
  }

  const beforePreserved = preservedCounts(beforeTags);
  const afterPreserved = preservedCounts(afterTags);
  const preservedTagCounts = Object.fromEntries(
    PRESERVED_TAGS.map((tag) => [
      tag,
      { before: beforePreserved[tag], after: afterPreserved[tag] },
    ]),
  ) as RunSummary["preservedTagCounts"];
  const mappedCount = results
    .flatMap((result) => [...result.perTagSource.values()])
    .filter((source) => source !== "dropped").length;
  const droppedCount = results
    .flatMap((result) => [...result.perTagSource.values()])
    .filter((source) => source === "dropped").length;
  const totalOriginalTags = beforeTags.length;
  const distinctAfter = new Set(afterTags).size;
  if (distinctAfter > DISTINCT_AFTER_THRESHOLD) {
    throw new Error(
      `ABORT: distinct-after tag count (${distinctAfter}) exceeds threshold (${DISTINCT_AFTER_THRESHOLD})`,
    );
  }

  return {
    brandsScanned: results.length,
    brandsChanged: results.filter(
      (result) =>
        !sameArray(result.beforeZh, result.afterZh) ||
        !sameArray(result.beforeEn, result.afterEn),
    ).length,
    distinctBefore: new Set(beforeTags).size,
    distinctAfter,
    totalOriginalTags,
    mappedCount,
    droppedCount,
    pctMapped:
      totalOriginalTags > 0
        ? ((mappedCount / totalOriginalTags) * 100).toFixed(1)
        : "0",
    preservedTagCounts,
    productTypeTotals: productTypeTotals(results),
  };
}

// ---------------------------------------------------------------------------
// Run artifact
// ---------------------------------------------------------------------------

function artifactRowFromResult(result: BrandResult): ArtifactRow {
  return {
    id: result.brand.id,
    slug: result.brand.slug,
    status: result.brand.status,
    productType: result.brand.product_type,
    before: {
      productTags: result.beforeZh,
      productTagsEn: result.beforeEn,
      pairs: toTagPairs(result.beforeZh, result.beforeEn),
    },
    after: {
      productTags: result.afterZh,
      productTagsEn: result.afterEn,
      pairs: toTagPairs(result.afterZh, result.afterEn),
    },
    sources: Object.fromEntries(result.perTagSource.entries()),
  };
}

export function createRunArtifact(
  results: BrandResult[],
  createdAt = new Date().toISOString(),
  auditEvents: ChatAuditEvent[] = [],
  planningCalls?: PlanningCall[],
): RunArtifact {
  const summary = validateResults(results);
  const rows = results.map(artifactRowFromResult);
  return {
    version: RUN_ARTIFACT_VERSION,
    kind: ARTIFACT_KIND,
    createdAt,
    planningCalls: planningCalls ?? expectedPlanningCallsForResults(results),
    auditEvents,
    review: {
      status: "pending",
      reviewer: null,
      reviewedAt: null,
    },
    summary,
    rows,
    rollback: {
      strategy: "restore-before-values",
      rows: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        productTags: row.before.productTags,
        productTagsEn: row.before.productTagsEn,
      })),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, pathLabel: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`Malformed artifact: ${pathLabel} must be a string array`);
  }
  return value;
}

function nullableStringArray(
  value: unknown,
  pathLabel: string,
): string[] | null {
  if (value === null) return null;
  return stringArray(value, pathLabel);
}

function tagPairs(value: unknown, pathLabel: string): TagPair[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed artifact: ${pathLabel} must be an array`);
  }
  return value.map((pair, index) => {
    if (!isRecord(pair) || typeof pair.zh !== "string") {
      throw new Error(`Malformed artifact: ${pathLabel}[${index}] is invalid`);
    }
    if (pair.en !== null && typeof pair.en !== "string") {
      throw new Error(
        `Malformed artifact: ${pathLabel}[${index}].en is invalid`,
      );
    }
    return { zh: pair.zh, en: pair.en as string | null };
  });
}

function auditEvents(value: unknown): ChatAuditEvent[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed artifact: auditEvents must be an array");
  }

  return value.map((rawEvent, index) => {
    if (!isRecord(rawEvent)) {
      throw new Error(`Malformed artifact: auditEvents[${index}] is invalid`);
    }
    if (
      (rawEvent.provider !== "deepseek" && rawEvent.provider !== "openai") ||
      typeof rawEvent.model !== "string" ||
      typeof rawEvent.ok !== "boolean" ||
      typeof rawEvent.status !== "number" ||
      !Number.isInteger(rawEvent.status) ||
      rawEvent.status < 0 ||
      typeof rawEvent.latencyMs !== "number" ||
      !Number.isFinite(rawEvent.latencyMs) ||
      rawEvent.latencyMs < 0 ||
      !Object.hasOwn(rawEvent, "data") ||
      rawEvent.data === undefined ||
      !isRecord(rawEvent.request) ||
      typeof rawEvent.request.system !== "string" ||
      typeof rawEvent.request.user !== "string" ||
      typeof rawEvent.request.imageCount !== "number" ||
      !Number.isInteger(rawEvent.request.imageCount) ||
      rawEvent.request.imageCount < 0
    ) {
      throw new Error(`Malformed artifact: auditEvents[${index}] is invalid`);
    }
    const retryAttempt = rawEvent.retryAttempt;
    if (
      typeof retryAttempt !== "number" ||
      !Number.isInteger(retryAttempt) ||
      retryAttempt < 0
    ) {
      throw new Error(
        `Malformed artifact: auditEvents[${index}].retryAttempt is invalid`,
      );
    }
    if (rawEvent.usage !== undefined && !isRecord(rawEvent.usage)) {
      throw new Error(
        `Malformed artifact: auditEvents[${index}].usage is invalid`,
      );
    }
    if (rawEvent.ok) {
      const usage = rawEvent.usage;
      if (
        !isRecord(usage) ||
        !["prompt_tokens", "completion_tokens", "total_tokens"].every(
          (key) =>
            typeof usage[key] === "number" &&
            Number.isFinite(usage[key]) &&
            usage[key] >= 0,
        )
      ) {
        throw new Error(
          `Malformed artifact: auditEvents[${index}].usage is required for successful calls`,
        );
      }
    } else {
      const error = rawEvent.error;
      const hasError = typeof error === "string" && error.trim().length > 0;
      const hasFailureStatus = rawEvent.status < 200 || rawEvent.status >= 300;
      if (!hasError && !hasFailureStatus) {
        throw new Error(
          `Malformed artifact: auditEvents[${index}] failure lacks error/status evidence`,
        );
      }
    }
    if (rawEvent.meta !== undefined && !isRecord(rawEvent.meta)) {
      throw new Error(
        `Malformed artifact: auditEvents[${index}].meta is invalid`,
      );
    }
    if (rawEvent.error !== undefined && typeof rawEvent.error !== "string") {
      throw new Error(
        `Malformed artifact: auditEvents[${index}].error is invalid`,
      );
    }

    return rawEvent as ChatAuditEvent;
  });
}

function parsePlanningCalls(value: unknown): PlanningCall[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed artifact: planningCalls must be an array");
  }

  return value.map((rawCall, index) => {
    if (
      !isRecord(rawCall) ||
      typeof rawCall.category !== "string" ||
      !rawCall.category.trim() ||
      rawCall.operation !== PLANNING_OPERATION
    ) {
      throw new Error(`Malformed artifact: planningCalls[${index}] is invalid`);
    }
    return {
      category: rawCall.category,
      operation: PLANNING_OPERATION,
    };
  });
}

function planningCallKey(call: PlanningCall): string {
  return `${call.category}\u0000${call.operation}`;
}

function assertPlanningCallManifest(
  rows: ArtifactRow[],
  actual: PlanningCall[],
): void {
  const expected = expectedPlanningCallsForRows(rows);
  const expectedKeys = new Set(expected.map(planningCallKey));
  const actualKeys = new Set(actual.map(planningCallKey));
  const missing = expected
    .filter((call) => !actualKeys.has(planningCallKey(call)))
    .map((call) => call.category);
  const extra = actual
    .filter((call) => !expectedKeys.has(planningCallKey(call)))
    .map((call) => call.category);
  const duplicateCount = actual.length - actualKeys.size;

  if (missing.length > 0 || extra.length > 0 || duplicateCount > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(extra.length > 0 ? [`extra: ${extra.join(", ")}`] : []),
      ...(duplicateCount > 0 ? [`duplicates: ${duplicateCount}`] : []),
    ].join("; ");
    throw new Error(
      `Malformed artifact: planningCalls must exactly match model-assisted categories (${details})`,
    );
  }
}

function expectedPlanningCallsForRows(rows: ArtifactRow[]): PlanningCall[] {
  return planningCallsForCategories(
    collectPlanningCategories(
      rows.map((row) => ({
        category: row.productType ?? "unknown",
        unmatched: planTagBackfill(row.before.productTags).unmatched,
      })),
    ),
  );
}

function assertPlanningAuditCoverage(
  expectedCalls: PlanningCall[],
  events: ChatAuditEvent[],
): void {
  const missing = expectedCalls.filter(
    (expected) =>
      !events.some(
        (event) =>
          event.provider === "deepseek" &&
          event.meta?.category === expected.category &&
          event.meta?.operation === expected.operation,
      ),
  );
  if (missing.length > 0) {
    throw new Error(
      `ABORT: apply requires correlated audit evidence for planning call(s): ${missing
        .map((call) => `${call.category}/${call.operation}`)
        .join(", ")}`,
    );
  }
}

function assertPairedValues(value: ArtifactValue, pathLabel: string): void {
  const expected = toTagPairs(value.productTags, value.productTagsEn);
  if (JSON.stringify(expected) !== JSON.stringify(value.pairs)) {
    throw new Error(
      `Malformed artifact: ${pathLabel} paired values do not match arrays`,
    );
  }
}

function assertArtifactSummary(artifact: RunArtifact): void {
  if (!isRecord(artifact.summary)) {
    throw new Error("Malformed artifact: summary is required");
  }
  if (!Number.isInteger(artifact.summary.brandsScanned)) {
    throw new Error("Malformed artifact: summary.brandsScanned is invalid");
  }
  const categories = new Map<string, number>();
  for (const row of artifact.rows) {
    const category = row.productType ?? "unknown";
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const expectedTotals = Object.fromEntries(
    [...categories.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  if (
    JSON.stringify(expectedTotals) !==
    JSON.stringify(artifact.summary.productTypeTotals)
  ) {
    throw new Error(
      "Malformed artifact: product_type totals do not match rows",
    );
  }
  if (artifact.summary.brandsScanned !== artifact.rows.length) {
    throw new Error(
      "Malformed artifact: summary row count does not match rows",
    );
  }

  const computed = validateResults(
    artifact.rows.map((row) => ({
      brand: {
        id: row.id,
        slug: row.slug,
        status: row.status,
        product_type: row.productType,
        product_tags: row.before.productTags,
        product_tags_en: row.before.productTagsEn,
      },
      beforeZh: row.before.productTags,
      beforeEn: row.before.productTagsEn,
      afterZh: row.after.productTags,
      afterEn: row.after.productTagsEn,
      perTagSource: new Map(Object.entries(row.sources)),
    })),
  );
  if (JSON.stringify(computed) !== JSON.stringify(artifact.summary)) {
    throw new Error("Malformed artifact: summary does not match row values");
  }
}

export function parseRunArtifact(
  value: unknown,
  options: { requireApproval?: boolean } = {},
): RunArtifact {
  if (!isRecord(value))
    throw new Error("Malformed artifact: root must be an object");
  if (value.version !== RUN_ARTIFACT_VERSION || value.kind !== ARTIFACT_KIND) {
    throw new Error("Malformed artifact: unsupported version or kind");
  }
  if (
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Malformed artifact: createdAt is invalid");
  }
  if (!isRecord(value.review)) {
    throw new Error("Malformed artifact: review metadata is required");
  }
  const review = value.review;
  if (review.status !== "pending" && review.status !== "approved") {
    throw new Error("Malformed artifact: review.status is invalid");
  }
  if (review.reviewer !== null && typeof review.reviewer !== "string") {
    throw new Error("Malformed artifact: review.reviewer is invalid");
  }
  if (review.reviewedAt !== null && typeof review.reviewedAt !== "string") {
    throw new Error("Malformed artifact: review.reviewedAt is invalid");
  }
  if (
    options.requireApproval &&
    (review.status !== "approved" ||
      !review.reviewer?.trim() ||
      !review.reviewedAt ||
      !Number.isFinite(Date.parse(review.reviewedAt)))
  ) {
    throw new Error(
      "ABORT: apply requires an approved artifact with reviewer and reviewedAt metadata",
    );
  }
  if (!Array.isArray(value.rows)) {
    throw new Error("Malformed artifact: rows must be an array");
  }
  if (
    !isRecord(value.rollback) ||
    value.rollback.strategy !== "restore-before-values"
  ) {
    throw new Error(
      "Malformed artifact: concrete rollback snapshot is required",
    );
  }
  if (!Array.isArray(value.rollback.rows)) {
    throw new Error("Malformed artifact: rollback.rows must be an array");
  }

  const ids = new Set<string>();
  const rows: ArtifactRow[] = value.rows.map((rawRow, index) => {
    if (!isRecord(rawRow))
      throw new Error(`Malformed artifact: rows[${index}] is invalid`);
    if (
      typeof rawRow.id !== "string" ||
      typeof rawRow.slug !== "string" ||
      typeof rawRow.status !== "string" ||
      (rawRow.productType !== null && typeof rawRow.productType !== "string") ||
      !isRecord(rawRow.before) ||
      !isRecord(rawRow.after) ||
      !isRecord(rawRow.sources)
    ) {
      throw new Error(`Malformed artifact: rows[${index}] metadata is invalid`);
    }
    if (ids.has(rawRow.id)) {
      throw new Error(`Malformed artifact: duplicate row id "${rawRow.id}"`);
    }
    ids.add(rawRow.id);

    const before: ArtifactValue = {
      productTags: stringArray(
        rawRow.before.productTags,
        `rows[${index}].before.productTags`,
      ),
      productTagsEn: nullableStringArray(
        rawRow.before.productTagsEn,
        `rows[${index}].before.productTagsEn`,
      ),
      pairs: tagPairs(rawRow.before.pairs, `rows[${index}].before.pairs`),
    };
    const afterEn = stringArray(
      rawRow.after.productTagsEn,
      `rows[${index}].after.productTagsEn`,
    );
    const after: ArtifactValue & { productTagsEn: string[] } = {
      productTags: stringArray(
        rawRow.after.productTags,
        `rows[${index}].after.productTags`,
      ),
      productTagsEn: afterEn,
      pairs: tagPairs(rawRow.after.pairs, `rows[${index}].after.pairs`),
    };
    assertPairedValues(before, `rows[${index}].before`);
    assertPairedValues(after, `rows[${index}].after`);
    if (
      before.productTagsEn !== null &&
      before.productTags.length !== before.productTagsEn.length
    ) {
      throw new Error(
        `Malformed artifact: rows[${index}].before zh/en arrays are unpaired`,
      );
    }
    if (before.productTags.length > 0 && after.productTags.length === 0) {
      throw new Error(`ABORT: rows[${index}] would remove every tag`);
    }
    if (after.productTags.length > MAX_TAGS) {
      throw new Error(`ABORT: rows[${index}] exceeds the ${MAX_TAGS}-tag cap`);
    }
    for (const tag of PRESERVED_TAGS) {
      const beforeCount = before.productTags.filter(
        (value) => value === tag,
      ).length;
      const afterCount = after.productTags.filter(
        (value) => value === tag,
      ).length;
      if (beforeCount !== afterCount) {
        throw new Error(
          `ABORT: preserved tag "${tag}" changed in row ${rawRow.slug}`,
        );
      }
    }

    const sources = Object.fromEntries(
      Object.entries(rawRow.sources).map(([sourceTag, source]) => {
        if (
          source !== "matched" &&
          source !== "llm" &&
          source !== "novel" &&
          source !== "preserved" &&
          source !== "dropped"
        ) {
          throw new Error(
            `Malformed artifact: rows[${index}].sources is invalid`,
          );
        }
        return [sourceTag, source];
      }),
    ) as Record<string, TagSource>;

    return {
      id: rawRow.id,
      slug: rawRow.slug,
      status: rawRow.status,
      productType: rawRow.productType,
      before,
      after,
      sources,
    };
  });

  const rollbackRows = value.rollback.rows.map((rawRow, index) => {
    if (!isRecord(rawRow))
      throw new Error(`Malformed artifact: rollback.rows[${index}] is invalid`);
    if (typeof rawRow.id !== "string" || typeof rawRow.slug !== "string") {
      throw new Error(
        `Malformed artifact: rollback.rows[${index}] metadata is invalid`,
      );
    }
    return {
      id: rawRow.id,
      slug: rawRow.slug,
      productTags: stringArray(
        rawRow.productTags,
        `rollback.rows[${index}].productTags`,
      ),
      productTagsEn: nullableStringArray(
        rawRow.productTagsEn,
        `rollback.rows[${index}].productTagsEn`,
      ),
    };
  });
  if (rollbackRows.length !== rows.length) {
    throw new Error(
      "Malformed artifact: rollback row count does not match rows",
    );
  }
  for (const [index, row] of rows.entries()) {
    const rollback = rollbackRows[index];
    if (
      rollback.id !== row.id ||
      rollback.slug !== row.slug ||
      !sameArray(rollback.productTags, row.before.productTags) ||
      !sameArray(rollback.productTagsEn, row.before.productTagsEn)
    ) {
      throw new Error(
        `Malformed artifact: rollback row ${index} does not restore before values`,
      );
    }
  }

  const parsedPlanningCalls = parsePlanningCalls(value.planningCalls);
  assertPlanningCallManifest(rows, parsedPlanningCalls);

  const artifact = {
    version: RUN_ARTIFACT_VERSION,
    kind: ARTIFACT_KIND,
    createdAt: value.createdAt,
    planningCalls: parsedPlanningCalls,
    auditEvents: auditEvents(value.auditEvents),
    review: {
      status: review.status,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
    },
    summary: value.summary as RunSummary,
    rows,
    rollback: {
      strategy: "restore-before-values" as const,
      rows: rollbackRows,
    },
  } satisfies RunArtifact;
  if (options.requireApproval) {
    assertPlanningAuditCoverage(artifact.planningCalls, artifact.auditEvents);
  }
  assertArtifactSummary(artifact);
  return artifact;
}

export function defaultArtifactPath(
  createdAt = new Date().toISOString(),
): string {
  const safeTimestamp = createdAt.replace(/[:.]/g, "-");
  return path.resolve(
    "scripts/eval/results",
    `normalize-product-tags-${safeTimestamp}.json`,
  );
}

async function writeRunArtifact(
  artifact: RunArtifact,
  outputPath = defaultArtifactPath(artifact.createdAt),
): Promise<string> {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return resolved;
}

async function readRunArtifact(
  artifactPath: string,
  options: { requireApproval?: boolean } = {},
): Promise<RunArtifact> {
  let raw: string;
  try {
    raw = await readFile(path.resolve(artifactPath), "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read artifact "${artifactPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed artifact "${artifactPath}": invalid JSON`);
  }
  return parseRunArtifact(parsed, options);
}

// ---------------------------------------------------------------------------
// Apply boundary
// ---------------------------------------------------------------------------

export async function applyRunArtifact(
  supabase: SupabaseClient,
  artifact: RunArtifact,
): Promise<number> {
  const reviewed = parseRunArtifact(artifact, { requireApproval: true });

  // Full preflight catches every known drift before the first write. Each
  // changed row is read again immediately before its own write to catch a
  // concurrent edit after preflight as well.
  for (const row of reviewed.rows) {
    const current = await loadBrandSnapshot(supabase, row.id);
    assertCurrentMatchesArtifact(current, row);
  }

  let writeCount = 0;
  for (const row of reviewed.rows) {
    if (
      sameArray(row.before.productTags, row.after.productTags) &&
      sameArray(row.before.productTagsEn, row.after.productTagsEn)
    ) {
      continue;
    }

    const current = await loadBrandSnapshot(supabase, row.id);
    assertCurrentMatchesArtifact(current, row);
    const written = await updateBrand(
      row.id,
      {
        productTags: row.after.productTags,
        productTagsEn: row.after.productTagsEn,
      },
      { source: "enriched" },
    );
    if (written.skipped.length > 0) {
      const detail = written.skipped
        .map((entry) => `${entry.field}:${entry.reason}`)
        .join(", ");
      throw new Error(`ABORT: write for "${row.slug}" was skipped: ${detail}`);
    }
    if (
      !sameArray(written.productTags, row.after.productTags) ||
      !sameArray(written.productTagsEn, row.after.productTagsEn)
    ) {
      throw new Error(`ABORT: write verification failed for "${row.slug}"`);
    }
    writeCount += 1;
  }
  return writeCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function planAndWrite(options: CliOptions): Promise<void> {
  const supabase = createServiceClient();
  const auditEvents: ChatAuditEvent[] = [];
  const deepseek = createPlanningDeepSeekClient(auditEvents);
  const brands = await loadApprovedBrands(supabase, options.batchSize);
  console.log(`Loaded ${brands.length} brand(s) with product_tags`);

  const brandPlans = brands.map((brand) => ({
    brand,
    plan: planTagBackfill(brand.product_tags ?? []),
  }));
  const categoryUnmatched = collectPlanningCategories(
    brandPlans.map(({ brand, plan }) => ({
      category: brand.product_type ?? "unknown",
      unmatched: plan.unmatched,
    })),
  );
  const planningCalls = planningCallsForCategories(categoryUnmatched);

  const globalLlmMapping = new Map<string, Map<string, string | null>>();
  for (const [category, tags] of categoryUnmatched) {
    if (tags.size === 0) continue;
    console.log(`[llm] mapping ${tags.size} tag(s) for category "${category}"`);
    globalLlmMapping.set(
      category,
      await mapTagsWithLlm(deepseek, category, [...tags]),
    );
  }

  const results = brandPlans.map(({ brand, plan }) =>
    composeResult(
      brand,
      plan,
      globalLlmMapping.get(brand.product_type ?? "unknown") ?? new Map(),
    ),
  );
  const artifact = createRunArtifact(
    results,
    undefined,
    auditEvents,
    planningCalls,
  );
  const outputPath = await writeRunArtifact(artifact);
  console.log(`Run artifact written to ${outputPath}`);
  console.log(
    "Review representative aliases and aggregate deltas, then set review.status=approved, review.reviewer, and review.reviewedAt before applying.",
  );
  console.log(JSON.stringify(artifact.summary, null, 2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) {
    const artifact = await readRunArtifact(options.artifactPath!, {
      requireApproval: true,
    });
    const supabase = createServiceClient();
    const writeCount = await applyRunArtifact(supabase, artifact);
    console.log(`Applied ${writeCount} reviewed brand tag update(s)`);
    return;
  }

  await planAndWrite(options);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
