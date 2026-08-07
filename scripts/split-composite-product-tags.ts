/**
 * Plan and apply the reviewed DEV-1361 product-tag split.
 *
 * Planning is the default and only reads approved brands carrying one of the
 * eight retired composite labels. The classifier is called once per brand,
 * because the same source label can legitimately become one or both atomic
 * products depending on that brand's evidence. Applying a run requires an
 * explicitly approved artifact and never calls the model.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/split-composite-product-tags.ts
 *   pnpm exec tsx --env-file=.env.local scripts/split-composite-product-tags.ts \
 *     --apply --artifact=scripts/eval/results/split-composite-product-tags-<timestamp>.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash, randomUUID } from "node:crypto";
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
  RETIRED_COMPOSITE_LABELS,
  isRetiredCompositeLabel,
  normalizeTagKey,
  subcategoryBySlug,
  type ProductSubcategory,
} from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Constants and split ownership
// ---------------------------------------------------------------------------

export const MAX_TAGS = 5;
export const RUN_ARTIFACT_VERSION = 1;
export const ARTIFACT_KIND = "split-composite-product-tags" as const;
export const PLANNING_OPERATION =
  "split-composite-product-tags.classify" as const;

export type SplitDefinition = {
  source: (typeof RETIRED_COMPOSITE_LABELS)[number];
  targetSlugs: readonly [string, string];
};

export const SPLIT_DEFINITIONS: readonly SplitDefinition[] = [
  { source: "香氛・蠟燭", targetSlugs: ["home-fragrance", "candles"] },
  { source: "鑰匙圈・吊飾", targetSlugs: ["keychains", "charms"] },
  {
    source: "收納包・化妝包",
    targetSlugs: ["storage-pouches", "cosmetic-bags"],
  },
  { source: "茶包・茶飲", targetSlugs: ["tea-bags", "tea-drinks"] },
  { source: "玩具・教具", targetSlugs: ["toys", "learning-aids"] },
  { source: "花藝・植栽", targetSlugs: ["floral-arrangements", "plants"] },
  { source: "毛巾・生活織品", targetSlugs: ["towels", "home-textiles"] },
  { source: "手機袋・手機背帶", targetSlugs: ["phone-bags", "phone-straps"] },
] as const;

const definitionByKey = new Map<string, SplitDefinition>(
  SPLIT_DEFINITIONS.map((definition) => [
    normalizeTagKey(definition.source),
    definition,
  ]),
);

const subcategoryByTarget = new Map<string, ProductSubcategory>();
for (const definition of SPLIT_DEFINITIONS) {
  for (const slug of definition.targetSlugs) {
    const subcategory = subcategoryBySlug(slug);
    if (!subcategory)
      throw new Error(`DEV-1361 target slug is missing from ontology: ${slug}`);
    subcategoryByTarget.set(slug, subcategory);
  }
}

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
  name: string;
  blurb: string | null;
  description: string | null;
  site_content: unknown;
  product_type: string | null;
  product_tags: string[] | null;
  product_tags_en: string[] | null;
};

export type SplitDecision = "one" | "both" | "needs-review";

export type SplitAssignment = {
  sourceLabel: string;
  decision: SplitDecision;
  targetSlugs: string[];
  rationale: string | null;
};

export type TagPair = { zh: string; en: string | null };

export type OverflowReview = {
  status: "none" | "needs-review" | "approved";
  candidates: TagPair[];
  evicted: TagPair[];
  rationale: string | null;
};

type TagValue = {
  productTags: string[];
  productTagsEn: string[] | null;
  pairs: TagPair[];
};

export type SplitRow = {
  id: string;
  slug: string;
  status: string;
  name: string;
  blurb: string | null;
  description: string | null;
  siteContent: unknown;
  productType: string | null;
  callId: string;
  sourceLabels: string[];
  before: TagValue;
  after: TagValue & { productTagsEn: string[] };
  assignments: SplitAssignment[];
  overflowReview: OverflowReview;
};

export type PlanningCall = {
  callId: string;
  brandId: string;
  brandSlug: string;
  sourceLabels: string[];
  operation: typeof PLANNING_OPERATION;
  requestDigest: string;
};

type ArtifactReview = {
  status: "pending" | "approved";
  reviewer: string | null;
  reviewedAt: string | null;
};

export type RunSummary = {
  brandsScanned: number;
  brandsChanged: number;
  sourceDecisions: Record<SplitDecision, number>;
  targetAssignments: Record<string, number>;
  needsReviewBrands: number;
  overflowBrands: number;
  sourceCounts: Record<string, number>;
};

export type RunArtifact = {
  version: typeof RUN_ARTIFACT_VERSION;
  kind: typeof ARTIFACT_KIND;
  createdAt: string;
  operation: typeof PLANNING_OPERATION;
  scope: { brandIds: string[]; scopeHash: string };
  planningCalls: PlanningCall[];
  auditEvents: ChatAuditEvent[];
  review: ArtifactReview;
  summary: RunSummary;
  rows: SplitRow[];
  rollback: {
    strategy: "restore-before-values";
    rows: Array<{
      id: string;
      slug: string;
      productTags: string[];
      productTagsEn: string[] | null;
    }>;
  };
};

// ---------------------------------------------------------------------------
// CLI and deterministic helpers
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
  if (unknown.length > 0)
    throw new Error(`Unknown option(s): ${unknown.join(", ")}`);
  if (apply && dryRunFlag)
    throw new Error("--apply and --dry-run cannot be combined");

  const batchSize = batchSizeArg
    ? Number(batchSizeArg.slice("--batch-size=".length))
    : 50;
  if (!Number.isInteger(batchSize) || batchSize <= 0)
    throw new Error("--batch-size must be a positive integer");

  const artifactPath = artifactArg
    ? artifactArg.slice("--artifact=".length).trim()
    : null;
  if (artifactArg && !artifactPath)
    throw new Error("--artifact must include a file path");
  if (artifactPath && !apply)
    throw new Error("--artifact is only valid with --apply");
  if (apply && !artifactPath)
    throw new Error("--apply requires an explicit --artifact=<path>");

  return { apply, dryRun: !apply, batchSize, artifactPath };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestRequest(system: string, user: string): string {
  return createHash("sha256")
    .update(stableJson({ system, user }))
    .digest("hex");
}

function sameArray(left: string[] | null, right: string[] | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

function sourceDefinitionForTag(tag: string): SplitDefinition | null {
  return definitionByKey.get(normalizeTagKey(tag)) ?? null;
}

export function sourceLabelsForTags(tags: string[]): string[] {
  const labels: string[] = [];
  for (const definition of SPLIT_DEFINITIONS) {
    if (
      tags.some(
        (tag) => sourceDefinitionForTag(tag)?.source === definition.source,
      )
    )
      labels.push(definition.source);
  }
  return labels;
}

function canonicalTargetSlugs(
  definition: SplitDefinition,
  decision: SplitDecision,
  targetSlugs: string[],
): string[] {
  if (decision === "needs-review") return [];
  const expected = [...definition.targetSlugs];
  if (decision === "one") {
    if (targetSlugs.length !== 1) return [];
    const chosen = targetSlugs[0];
    return chosen && expected.includes(chosen) ? [chosen] : [];
  }
  if (
    targetSlugs.length !== expected.length ||
    new Set(targetSlugs).size !== expected.length ||
    expected.some((slug) => !targetSlugs.includes(slug))
  )
    return [];
  return expected;
}

function appendUniquePair(
  pairs: Array<{ zh: string; en: string }>,
  pair: { zh: string; en: string },
): void {
  const key = normalizeTagKey(pair.zh);
  if (pairs.some((existing) => normalizeTagKey(existing.zh) === key)) return;
  pairs.push(pair);
}

function sameTagPair(left: TagPair, right: TagPair): boolean {
  return left.zh === right.zh && left.en === right.en;
}

function sameTagPairList(left: TagPair[], right: TagPair[]): boolean {
  return (
    left.length === right.length &&
    left.every((pair, index) => {
      const other = right[index];
      return other !== undefined && sameTagPair(pair, other);
    })
  );
}

function buildPredictedPairs(
  beforeTags: string[],
  beforeEn: string[] | null,
  assignments: SplitAssignment[],
): TagPair[] {
  const assignmentBySource = new Map(
    assignments.map((assignment) => [
      normalizeTagKey(assignment.sourceLabel),
      assignment,
    ]),
  );
  const pairs: Array<{ zh: string; en: string }> = [];

  for (let index = 0; index < beforeTags.length; index += 1) {
    const rawTag = beforeTags[index] ?? "";
    const definition = sourceDefinitionForTag(rawTag);
    const assignment = definition
      ? assignmentBySource.get(normalizeTagKey(definition.source))
      : undefined;

    if (!definition || !assignment || assignment.decision === "needs-review") {
      appendUniquePair(pairs, { zh: rawTag, en: beforeEn?.[index] ?? rawTag });
      continue;
    }

    const targetSlugs = canonicalTargetSlugs(
      definition,
      assignment.decision,
      assignment.targetSlugs,
    );
    for (const slug of targetSlugs) {
      const target = subcategoryByTarget.get(slug);
      if (!target) continue;
      appendUniquePair(pairs, { zh: target.nameZh, en: target.nameEn });
    }
  }

  return pairs.map((pair) => ({ zh: pair.zh, en: pair.en }));
}

function buildOverflowReview(
  beforePairs: TagPair[],
  predictedPairs: TagPair[],
): OverflowReview {
  if (predictedPairs.length <= MAX_TAGS) {
    return { status: "none", candidates: [], evicted: [], rationale: null };
  }
  const candidates = beforePairs.filter(
    (pair) =>
      !sourceDefinitionForTag(pair.zh) &&
      predictedPairs.some(
        (predicted) =>
          normalizeTagKey(predicted.zh) === normalizeTagKey(pair.zh),
      ),
  );
  return {
    status: "needs-review",
    candidates,
    evicted: [],
    rationale:
      "The split exceeds the five-tag cap; review the proposed non-source evictions before applying.",
  };
}

/**
 * Build one before/after row from a reviewed set of per-source decisions. A
 * needs-review decision leaves the source value in `after` so the pending
 * artifact remains inspectable, but apply validation refuses it.
 */
export function buildSplitRow(
  brand: BrandRow,
  callId: string,
  assignments: SplitAssignment[],
): SplitRow {
  const beforeTags = brand.product_tags ?? [];
  const beforeEn = brand.product_tags_en;
  const sourceLabels = sourceLabelsForTags(beforeTags);
  const normalizedAssignments = sourceLabels.map((sourceLabel) => {
    const assignment = assignments.find(
      (candidate) =>
        normalizeTagKey(candidate.sourceLabel) === normalizeTagKey(sourceLabel),
    );
    return (
      assignment ?? {
        sourceLabel,
        decision: "needs-review" as const,
        targetSlugs: [],
        rationale: "Missing classifier decision",
      }
    );
  });
  const predictedPairs = buildPredictedPairs(
    beforeTags,
    beforeEn,
    normalizedAssignments,
  );
  const overflowReview = buildOverflowReview(
    toTagPairs(beforeTags, beforeEn),
    predictedPairs,
  );
  const afterTags = predictedPairs.map((pair) => pair.zh);
  const afterEn = predictedPairs.map((pair) => pair.en ?? pair.zh);

  return {
    id: brand.id,
    slug: brand.slug,
    status: brand.status,
    name: brand.name,
    blurb: brand.blurb,
    description: brand.description,
    siteContent: brand.site_content,
    productType: brand.product_type,
    callId,
    sourceLabels,
    before: {
      productTags: beforeTags,
      productTagsEn: beforeEn,
      pairs: toTagPairs(beforeTags, beforeEn),
    },
    after: {
      productTags: afterTags,
      productTagsEn: afterEn,
      pairs: predictedPairs,
    },
    assignments: normalizedAssignments,
    overflowReview,
  };
}

export function validateSplitRow(
  row: SplitRow,
  options: { forApply?: boolean } = {},
): void {
  const expectedSources = sourceLabelsForTags(row.before.productTags);
  if (JSON.stringify(row.sourceLabels) !== JSON.stringify(expectedSources)) {
    throw new Error(
      `Malformed split artifact: source labels do not match the before tags for "${row.slug}"`,
    );
  }
  const assignmentKeys = row.assignments.map((assignment) =>
    normalizeTagKey(assignment.sourceLabel),
  );
  if (
    assignmentKeys.length !== expectedSources.length ||
    new Set(assignmentKeys).size !== assignmentKeys.length ||
    expectedSources.some(
      (source) => !assignmentKeys.includes(normalizeTagKey(source)),
    )
  ) {
    throw new Error(
      `Malformed split artifact: split decisions do not exactly cover source labels for "${row.slug}"`,
    );
  }
  if (row.after.productTags.length !== row.after.productTagsEn.length) {
    throw new Error(
      `ABORT: brand "${row.slug}" has unpaired zh/en after values`,
    );
  }
  if (
    row.before.productTagsEn !== null &&
    row.before.productTags.length !== row.before.productTagsEn.length
  ) {
    throw new Error(
      `ABORT: brand "${row.slug}" has unpaired zh/en before values`,
    );
  }
  if (
    JSON.stringify(row.before.pairs) !==
    JSON.stringify(toTagPairs(row.before.productTags, row.before.productTagsEn))
  ) {
    throw new Error(
      `Malformed split artifact: ${row.slug} before pairs do not match arrays`,
    );
  }
  if (
    JSON.stringify(row.after.pairs) !==
    JSON.stringify(toTagPairs(row.after.productTags, row.after.productTagsEn))
  ) {
    throw new Error(
      `Malformed split artifact: ${row.slug} after pairs do not match arrays`,
    );
  }

  for (const assignment of row.assignments) {
    const definition = sourceDefinitionForTag(assignment.sourceLabel);
    if (!definition)
      throw new Error(
        `ABORT: unknown source label "${assignment.sourceLabel}" for ${row.slug}`,
      );
    const expected = new Set(definition.targetSlugs);
    if (assignment.decision === "needs-review") {
      if (assignment.targetSlugs.length !== 0) {
        throw new Error(
          `ABORT: needs-review decision for "${assignment.sourceLabel}" must not carry replacement slugs`,
        );
      }
      continue;
    }
    const expectedTargets = canonicalTargetSlugs(
      definition,
      assignment.decision,
      assignment.targetSlugs,
    );
    if (
      expectedTargets.length === 0 ||
      assignment.targetSlugs.some((slug) => !expected.has(slug))
    ) {
      throw new Error(
        `ABORT: invalid replacement slugs for "${assignment.sourceLabel}" on ${row.slug}`,
      );
    }
  }

  const predictedPairs = buildPredictedPairs(
    row.before.productTags,
    row.before.productTagsEn,
    row.assignments,
  );
  const expectedOverflow = buildOverflowReview(
    row.before.pairs,
    predictedPairs,
  );
  if (
    !sameTagPairList(row.overflowReview.candidates, expectedOverflow.candidates)
  ) {
    throw new Error(
      `Malformed split artifact: overflow candidates do not match before tags for "${row.slug}"`,
    );
  }
  const selected = row.overflowReview.evicted;
  const selectedKeys = new Set<string>();
  for (const pair of selected) {
    const key = normalizeTagKey(pair.zh);
    if (selectedKeys.has(key))
      throw new Error(
        `ABORT: duplicate overflow eviction "${pair.zh}" for ${row.slug}`,
      );
    selectedKeys.add(key);
    const beforePair = row.before.pairs.find(
      (candidate) => normalizeTagKey(candidate.zh) === key,
    );
    if (!beforePair || !sameTagPair(beforePair, pair))
      throw new Error(
        `ABORT: overflow eviction "${pair.zh}" is not an exact before tag for ${row.slug}`,
      );
    if (sourceDefinitionForTag(pair.zh))
      throw new Error(
        `ABORT: retired source "${pair.zh}" cannot be selected as an overflow eviction for ${row.slug}`,
      );
    if (
      !expectedOverflow.candidates.some((candidate) =>
        sameTagPair(candidate, pair),
      )
    )
      throw new Error(
        `ABORT: overflow eviction "${pair.zh}" is not a proposed candidate for ${row.slug}`,
      );
  }

  const expectedAfterPairs =
    expectedOverflow.status === "none"
      ? predictedPairs
      : row.overflowReview.status === "approved"
        ? predictedPairs.filter(
            (pair) => !selectedKeys.has(normalizeTagKey(pair.zh)),
          )
        : predictedPairs;
  if (!sameTagPairList(row.after.pairs, expectedAfterPairs))
    throw new Error(
      `Malformed split artifact: after tags do not match the reviewed split for "${row.slug}"`,
    );

  if (expectedOverflow.status === "none") {
    if (
      row.overflowReview.status !== "none" ||
      row.overflowReview.evicted.length > 0
    )
      throw new Error(
        `ABORT: overflow review is present on a row that fits the ${MAX_TAGS}-tag cap for ${row.slug}`,
      );
  } else {
    if (
      row.overflowReview.status !== "needs-review" &&
      row.overflowReview.status !== "approved"
    )
      throw new Error(`ABORT: overflow review is missing for "${row.slug}"`);
    if (
      row.overflowReview.status === "needs-review" &&
      row.overflowReview.evicted.length > 0
    )
      throw new Error(
        `ABORT: pending overflow review cannot contain an eviction decision for ${row.slug}`,
      );
    if (
      row.overflowReview.status === "approved" &&
      (row.after.productTags.length === 0 ||
        row.after.productTags.length > MAX_TAGS)
    )
      throw new Error(
        `ABORT: approved overflow review for ${row.slug} must leave 1-${MAX_TAGS} paired tags`,
      );
  }

  if (row.before.productTags.length > 0 && row.after.productTags.length === 0) {
    throw new Error(
      `ABORT: brand "${row.slug}" would go from tags to zero tags`,
    );
  }

  if (options.forApply) {
    if (
      row.assignments.some(
        (assignment) => assignment.decision === "needs-review",
      )
    ) {
      throw new Error(
        `ABORT: brand "${row.slug}" still has a needs-review split decision`,
      );
    }
    if (row.after.productTags.some(isRetiredCompositeLabel)) {
      throw new Error(
        `ABORT: retired composite remains after split for "${row.slug}"`,
      );
    }
    if (
      expectedOverflow.status !== "none" &&
      row.overflowReview.status !== "approved"
    ) {
      throw new Error(
        `ABORT: brand "${row.slug}" still requires an explicit overflow eviction review`,
      );
    }
  }
}

export function validateSplitRows(
  rows: SplitRow[],
  options: { forApply?: boolean } = {},
): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id))
      throw new Error(
        `ABORT: duplicate brand id "${row.id}" in split artifact`,
      );
    ids.add(row.id);
    validateSplitRow(row, options);
  }
}

// ---------------------------------------------------------------------------
// Classifier prompt and response boundary
// ---------------------------------------------------------------------------

export function buildClassifierPrompt(
  brand: BrandRow,
  sourceLabels: string[],
): { system: string; user: string } {
  const evidence = {
    name: brand.name,
    productType: brand.product_type,
    productTags: brand.product_tags ?? [],
    productTagsEn: brand.product_tags_en ?? [],
    blurb: brand.blurb,
    description: brand.description,
    siteContent: brand.site_content,
  };
  const sourceDetails = sourceLabels.map((source) => {
    const definition = sourceDefinitionForTag(source);
    return `${source}: ${definition?.targetSlugs.join(" / ") ?? "unknown"}`;
  });
  const system =
    "You classify Taiwanese brand product evidence for a reviewed ontology migration. Return JSON only. " +
    "Do not infer from the source label alone: use the brand name, descriptions, existing tags, and site evidence. " +
    "Choose one replacement, both replacements, or needs-review when evidence is ambiguous.";
  const user = [
    "Retired source labels and their only allowed replacement slugs:",
    ...sourceDetails,
    "",
    'Return {"assignments":{"source label":{"decision":"one|both|needs-review","targetSlugs":["slug"],"rationale":"short evidence-based reason"}}}.',
    "For needs-review, targetSlugs must be []. Never emit a slug outside the listed pair.",
    "",
    `Brand evidence:\n${JSON.stringify(evidence, null, 2)}`,
  ].join("\n");
  return { system, user };
}

function classifierBrandFromRow(row: SplitRow): BrandRow {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    name: row.name,
    blurb: row.blurb,
    description: row.description,
    site_content: row.siteContent,
    product_type: row.productType,
    product_tags: row.before.productTags,
    product_tags_en: row.before.productTagsEn,
  };
}

function expectedClassifierPrompt(row: SplitRow): {
  system: string;
  user: string;
} {
  return buildClassifierPrompt(classifierBrandFromRow(row), row.sourceLabels);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

export function parseClassifierAssignments(
  content: string | null,
  sourceLabels: string[],
): SplitAssignment[] {
  const parsed = content ? parseDeepSeekJson<unknown>(content) : null;
  const rawAssignments =
    isRecord(parsed) && isRecord(parsed.assignments)
      ? parsed.assignments
      : parsed;
  return sourceLabels.map((sourceLabel) => {
    const raw = isRecord(rawAssignments)
      ? rawAssignments[sourceLabel]
      : undefined;
    if (!isRecord(raw))
      return {
        sourceLabel,
        decision: "needs-review",
        targetSlugs: [],
        rationale: "Missing or malformed classifier output",
      };

    const decision = raw.decision;
    if (
      decision !== "one" &&
      decision !== "both" &&
      decision !== "needs-review"
    ) {
      return {
        sourceLabel,
        decision: "needs-review",
        targetSlugs: [],
        rationale: "Classifier did not return a valid decision",
      };
    }
    const rationale =
      typeof raw.rationale === "string" && raw.rationale.trim()
        ? raw.rationale.trim()
        : null;
    const targetSlugs = asStringArray(raw.targetSlugs);
    const definition = sourceDefinitionForTag(sourceLabel);
    if (!definition)
      return {
        sourceLabel,
        decision: "needs-review",
        targetSlugs: [],
        rationale: "Unknown source label",
      };
    if (decision === "needs-review")
      return { sourceLabel, decision, targetSlugs: [], rationale };
    const normalizedTargets = canonicalTargetSlugs(
      definition,
      decision,
      targetSlugs,
    );
    if (
      normalizedTargets.length === 0 ||
      targetSlugs.some((slug) => !definition.targetSlugs.includes(slug))
    ) {
      return {
        sourceLabel,
        decision: "needs-review",
        targetSlugs: [],
        rationale: "Classifier returned invalid replacement slugs",
      };
    }
    return { sourceLabel, decision, targetSlugs: normalizedTargets, rationale };
  });
}

export function createPlanningDeepSeekClient(auditEvents: ChatAuditEvent[]) {
  return createDeepSeekClient({
    onChatComplete: (event) => {
      auditEvents.push(event);
    },
  });
}

export async function classifyBrandWithLlm(
  client: ReturnType<typeof createDeepSeekClient>,
  brand: BrandRow,
  sourceLabels: string[],
  callId: string = randomUUID(),
): Promise<{ assignments: SplitAssignment[]; planningCall: PlanningCall }> {
  const prompt = buildClassifierPrompt(brand, sourceLabels);
  const planningCall: PlanningCall = {
    callId,
    brandId: brand.id,
    brandSlug: brand.slug,
    sourceLabels,
    operation: PLANNING_OPERATION,
    requestDigest: digestRequest(prompt.system, prompt.user),
  };
  const result = await client.chat({
    system: prompt.system,
    user: prompt.user,
    json: true,
    timeoutMs: 30_000,
    meta: {
      operation: PLANNING_OPERATION,
      correlationId: callId,
      brandId: brand.id,
      brandSlug: brand.slug,
      sourceLabels,
    },
  });
  return {
    assignments: parseClassifierAssignments(result.content, sourceLabels),
    planningCall,
  };
}

// ---------------------------------------------------------------------------
// Artifact creation and validation
// ---------------------------------------------------------------------------

function rowScopeValue(row: SplitRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    name: row.name,
    blurb: row.blurb,
    description: row.description,
    siteContent: row.siteContent,
    productType: row.productType,
    before: row.before,
  };
}

export function calculateScopeHash(rows: SplitRow[]): string {
  const scope = rows
    .map(rowScopeValue)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return createHash("sha256").update(stableJson(scope)).digest("hex");
}

function summaryForRows(rows: SplitRow[]): RunSummary {
  const sourceDecisions: Record<SplitDecision, number> = {
    one: 0,
    both: 0,
    "needs-review": 0,
  };
  const targetAssignments: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let brandsChanged = 0;
  let needsReviewBrands = 0;
  let overflowBrands = 0;

  for (const row of rows) {
    if (
      !sameArray(row.before.productTags, row.after.productTags) ||
      !sameArray(row.before.productTagsEn, row.after.productTagsEn)
    )
      brandsChanged += 1;
    let rowNeedsReview = false;
    for (const assignment of row.assignments) {
      sourceCounts[assignment.sourceLabel] =
        (sourceCounts[assignment.sourceLabel] ?? 0) + 1;
      sourceDecisions[assignment.decision] += 1;
      if (assignment.decision === "needs-review") rowNeedsReview = true;
      for (const target of assignment.targetSlugs)
        targetAssignments[target] = (targetAssignments[target] ?? 0) + 1;
    }
    if (row.overflowReview.status !== "none") overflowBrands += 1;
    if (rowNeedsReview || row.overflowReview.status !== "none")
      needsReviewBrands += 1;
  }
  return {
    brandsScanned: rows.length,
    brandsChanged,
    sourceDecisions,
    targetAssignments: Object.fromEntries(
      Object.entries(targetAssignments).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    needsReviewBrands,
    overflowBrands,
    sourceCounts: Object.fromEntries(
      Object.entries(sourceCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

export function createRunArtifact(
  rows: SplitRow[],
  planningCalls: PlanningCall[],
  auditEvents: ChatAuditEvent[] = [],
  createdAt = new Date().toISOString(),
): RunArtifact {
  validateSplitRows(rows);
  const expectedCallIds = new Set(rows.map((row) => row.callId));
  const actualCallIds = new Set(planningCalls.map((call) => call.callId));
  if (
    expectedCallIds.size !== actualCallIds.size ||
    [...expectedCallIds].some((id) => !actualCallIds.has(id))
  ) {
    throw new Error(
      "ABORT: planning call manifest does not exactly cover split rows",
    );
  }
  const artifact: RunArtifact = {
    version: RUN_ARTIFACT_VERSION,
    kind: ARTIFACT_KIND,
    createdAt,
    operation: PLANNING_OPERATION,
    scope: {
      brandIds: rows.map((row) => row.id).sort(),
      scopeHash: calculateScopeHash(rows),
    },
    planningCalls,
    auditEvents,
    review: { status: "pending", reviewer: null, reviewedAt: null },
    summary: summaryForRows(rows),
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
  assertPlanningAuditManifest(artifact, false);
  return artifact;
}

function validateAuditEvent(value: unknown, index: number): ChatAuditEvent {
  if (!isRecord(value))
    throw new Error(`Malformed artifact: auditEvents[${index}] is invalid`);
  if (value.provider !== "deepseek")
    throw new Error(
      `Malformed artifact: auditEvents[${index}] provider must be deepseek`,
    );
  if (
    typeof value.model !== "string" ||
    value.model.trim().length === 0 ||
    typeof value.ok !== "boolean" ||
    typeof value.status !== "number" ||
    !Number.isInteger(value.status) ||
    value.status < 0 ||
    (value.ok && (value.status < 200 || value.status >= 300)) ||
    (!value.ok && value.status >= 200 && value.status < 300)
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] must record a valid response attempt`,
    );
  if (
    !isRecord(value.request) ||
    typeof value.request.system !== "string" ||
    typeof value.request.user !== "string" ||
    !Number.isInteger(value.request.imageCount) ||
    value.request.imageCount !== 0
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] request is invalid`,
    );
  if (
    !Object.prototype.hasOwnProperty.call(value, "data") ||
    (value.ok
      ? !isRecord(value.data)
      : value.data !== null && !isRecord(value.data))
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] response payload/data is required`,
    );
  if (
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] latencyMs is invalid`,
    );
  if (
    typeof value.retryAttempt !== "number" ||
    !Number.isInteger(value.retryAttempt) ||
    value.retryAttempt < 0
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] retryAttempt is invalid`,
    );
  if (value.meta !== undefined && !isRecord(value.meta))
    throw new Error(
      `Malformed artifact: auditEvents[${index}] meta is invalid`,
    );
  if (!isRecord(value.usage))
    throw new Error(
      `Malformed artifact: auditEvents[${index}] call is missing usage`,
    );
  const usage = value.usage;
  const usageFields = [
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.total_tokens,
  ];
  if (
    usageFields.some(
      (count) =>
        typeof count !== "number" || !Number.isInteger(count) || count < 0,
    )
  )
    throw new Error(
      `Malformed artifact: auditEvents[${index}] token usage must contain numeric prompt, completion, and total counts`,
    );
  return value as ChatAuditEvent;
}

function assertPlanningAuditManifest(
  artifact: RunArtifact,
  requireCoverage: boolean,
): void {
  if (artifact.planningCalls.length !== artifact.rows.length)
    throw new Error(
      "Malformed artifact: exactly one planning call is required per row",
    );
  const rowsByCallId = new Map<string, SplitRow>();
  for (const row of artifact.rows) {
    if (rowsByCallId.has(row.callId))
      throw new Error(
        `Malformed artifact: duplicate row callId "${row.callId}"`,
      );
    rowsByCallId.set(row.callId, row);
  }

  const callsById = new Map<string, PlanningCall>();
  for (const call of artifact.planningCalls) {
    if (callsById.has(call.callId))
      throw new Error(
        `Malformed artifact: duplicate planning call "${call.callId}"`,
      );
    callsById.set(call.callId, call);
    const row = rowsByCallId.get(call.callId);
    if (
      !row ||
      call.brandId !== row.id ||
      call.brandSlug !== row.slug ||
      JSON.stringify(call.sourceLabels) !== JSON.stringify(row.sourceLabels) ||
      call.operation !== PLANNING_OPERATION ||
      !/^[a-f0-9]{64}$/.test(call.requestDigest)
    ) {
      throw new Error(
        `Malformed artifact: planning call "${call.callId}" does not match its row`,
      );
    }
    const prompt = expectedClassifierPrompt(row);
    if (call.requestDigest !== digestRequest(prompt.system, prompt.user))
      throw new Error(
        `Malformed artifact: planning call "${call.callId}" request digest does not match stored evidence`,
      );
  }

  for (const row of artifact.rows) {
    if (!callsById.has(row.callId))
      throw new Error(
        `Malformed artifact: row "${row.slug}" is missing its planning call`,
      );
  }

  const eventsByCallId = new Map<string, ChatAuditEvent[]>();
  const chainOrder: string[] = [];
  const closedCallIds = new Set<string>();
  let activeCallId: string | null = null;
  for (const [eventIndex, event] of artifact.auditEvents.entries()) {
    validateAuditEvent(event, eventIndex);
    const meta = event.meta;
    if (!meta)
      throw new Error(
        "Malformed artifact: every audit event must carry planning correlation metadata",
      );
    if (meta.operation !== PLANNING_OPERATION)
      throw new Error(
        "Malformed artifact: audit event has an unexpected operation",
      );
    if (
      typeof meta.correlationId !== "string" ||
      !callsById.has(meta.correlationId)
    )
      throw new Error(
        "Malformed artifact: audit event has an unknown correlationId",
      );
    const call = callsById.get(meta.correlationId)!;
    if (activeCallId !== meta.correlationId) {
      if (activeCallId !== null) closedCallIds.add(activeCallId);
      if (closedCallIds.has(meta.correlationId))
        throw new Error(
          `Malformed artifact: audit events for call "${meta.correlationId}" are not contiguous`,
        );
      activeCallId = meta.correlationId;
      chainOrder.push(meta.correlationId);
    }
    const chain = eventsByCallId.get(meta.correlationId) ?? [];
    if (chain.at(-1)?.ok === true)
      throw new Error(
        `Malformed artifact: audit event after terminal success for call "${meta.correlationId}"`,
      );
    if (
      meta.brandId !== call.brandId ||
      meta.brandSlug !== call.brandSlug ||
      JSON.stringify(meta.sourceLabels) !== JSON.stringify(call.sourceLabels)
    )
      throw new Error(
        `Malformed artifact: audit event is not correlated to call "${call.callId}"`,
      );
    const row = rowsByCallId.get(call.callId)!;
    const prompt = expectedClassifierPrompt(row);
    if (
      event.request.system !== prompt.system ||
      event.request.user !== prompt.user ||
      event.request.imageCount !== 0
    )
      throw new Error(
        `Malformed artifact: audit request does not match stored evidence for call "${call.callId}"`,
      );
    if (
      digestRequest(event.request.system, event.request.user) !==
      call.requestDigest
    )
      throw new Error(
        `Malformed artifact: audit request digest does not match call "${call.callId}"`,
      );
    if (chain[0] && event.model !== chain[0].model)
      throw new Error(
        `Malformed artifact: audit attempts for call "${call.callId}" use different models`,
      );
    chain.push(event);
    eventsByCallId.set(meta.correlationId, chain);
  }

  const expectedCallOrder = artifact.planningCalls.map((call) => call.callId);
  if (
    chainOrder.length !== expectedCallOrder.length ||
    chainOrder.some((callId, index) => callId !== expectedCallOrder[index])
  )
    throw new Error(
      "Malformed artifact: audit retry chains are not ordered like planning calls",
    );

  for (const call of artifact.planningCalls) {
    const chain = eventsByCallId.get(call.callId);
    if (!chain || chain.length === 0) continue;
    const attempts = chain.map((event) => event.retryAttempt);
    if (attempts.some((attempt, index) => attempt !== index))
      throw new Error(
        `Malformed artifact: audit retryAttempt sequence is not contiguous for call "${call.callId}"`,
      );
    const successfulAttempts = chain.filter((event) => event.ok);
    if (
      successfulAttempts.length !== 1 ||
      chain.at(-1)?.ok !== true ||
      chain.slice(0, -1).some((event) => event.ok)
    )
      throw new Error(
        `Malformed artifact: audit retry chain for call "${call.callId}" must end with exactly one terminal success`,
      );
  }
  const missing = artifact.planningCalls.filter(
    (call) => !eventsByCallId.has(call.callId),
  );
  if (
    missing.length > 0 ||
    (requireCoverage && eventsByCallId.size !== callsById.size)
  )
    throw new Error(
      `ABORT: audit evidence must exactly cover call(s): ${missing.map((call) => call.callId).join(", ") || "unknown"}`,
    );
}

function parseTagPairs(value: unknown, label: string): TagPair[] {
  if (!Array.isArray(value))
    throw new Error(`Malformed artifact: ${label} must be an array`);
  return value.map((raw, index) => {
    if (
      !isRecord(raw) ||
      typeof raw.zh !== "string" ||
      (raw.en !== null && typeof raw.en !== "string")
    )
      throw new Error(`Malformed artifact: ${label}[${index}] is invalid`);
    return { zh: raw.zh, en: raw.en as string | null };
  });
}

export function parseRunArtifact(
  value: unknown,
  options: { requireApproval?: boolean } = {},
): RunArtifact {
  if (
    !isRecord(value) ||
    value.version !== RUN_ARTIFACT_VERSION ||
    value.kind !== ARTIFACT_KIND ||
    value.operation !== PLANNING_OPERATION
  )
    throw new Error(
      "Malformed artifact: unsupported version, kind, or operation",
    );
  if (
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error("Malformed artifact: createdAt is invalid");
  if (
    !isRecord(value.scope) ||
    !Array.isArray(value.scope.brandIds) ||
    !value.scope.brandIds.every((id) => typeof id === "string") ||
    typeof value.scope.scopeHash !== "string"
  )
    throw new Error("Malformed artifact: scope is invalid");
  if (
    !isRecord(value.review) ||
    (value.review.status !== "pending" && value.review.status !== "approved") ||
    (value.review.reviewer !== null &&
      typeof value.review.reviewer !== "string") ||
    (value.review.reviewedAt !== null &&
      typeof value.review.reviewedAt !== "string")
  )
    throw new Error("Malformed artifact: review is invalid");
  if (
    options.requireApproval &&
    (value.review.status !== "approved" ||
      !value.review.reviewer?.trim() ||
      !value.review.reviewedAt ||
      !Number.isFinite(Date.parse(value.review.reviewedAt)))
  )
    throw new Error(
      "ABORT: apply requires an approved artifact with reviewer and reviewedAt metadata",
    );
  if (
    !Array.isArray(value.rows) ||
    !Array.isArray(value.planningCalls) ||
    !Array.isArray(value.auditEvents) ||
    !isRecord(value.rollback) ||
    value.rollback.strategy !== "restore-before-values" ||
    !Array.isArray(value.rollback.rows)
  )
    throw new Error(
      "Malformed artifact: rows, calls, audit events, and rollback are required",
    );

  const rows: SplitRow[] = value.rows.map((raw, index) => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.slug !== "string" ||
      typeof raw.status !== "string" ||
      typeof raw.name !== "string" ||
      typeof raw.callId !== "string" ||
      !Array.isArray(raw.sourceLabels) ||
      !raw.sourceLabels.every((label) => typeof label === "string") ||
      !isRecord(raw.before) ||
      !isRecord(raw.after) ||
      !isRecord(raw.overflowReview) ||
      !Array.isArray(raw.assignments) ||
      (raw.blurb !== null &&
        raw.blurb !== undefined &&
        typeof raw.blurb !== "string") ||
      (raw.description !== null &&
        raw.description !== undefined &&
        typeof raw.description !== "string") ||
      (raw.productType !== null &&
        raw.productType !== undefined &&
        typeof raw.productType !== "string")
    )
      throw new Error(`Malformed artifact: rows[${index}] metadata is invalid`);
    const beforeTags = raw.before.productTags;
    const beforeEn = raw.before.productTagsEn;
    const afterTags = raw.after.productTags;
    const afterEn = raw.after.productTagsEn;
    const overflowReview = raw.overflowReview;
    if (
      !Array.isArray(beforeTags) ||
      !beforeTags.every((tag) => typeof tag === "string") ||
      (beforeEn !== null &&
        (!Array.isArray(beforeEn) ||
          !beforeEn.every((tag) => typeof tag === "string"))) ||
      !Array.isArray(afterTags) ||
      !afterTags.every((tag) => typeof tag === "string") ||
      !Array.isArray(afterEn) ||
      !afterEn.every((tag) => typeof tag === "string") ||
      !["none", "needs-review", "approved"].includes(
        String(overflowReview.status),
      ) ||
      !Array.isArray(overflowReview.candidates) ||
      !Array.isArray(overflowReview.evicted) ||
      (overflowReview.rationale !== null &&
        typeof overflowReview.rationale !== "string")
    )
      throw new Error(
        `Malformed artifact: rows[${index}] tag values are invalid`,
      );
    const beforePairs = parseTagPairs(
      raw.before.pairs,
      `rows[${index}].before.pairs`,
    );
    const afterPairs = parseTagPairs(
      raw.after.pairs,
      `rows[${index}].after.pairs`,
    );
    const overflowCandidates = parseTagPairs(
      overflowReview.candidates,
      `rows[${index}].overflowReview.candidates`,
    );
    const overflowEvicted = parseTagPairs(
      overflowReview.evicted,
      `rows[${index}].overflowReview.evicted`,
    );
    const assignments: SplitAssignment[] = raw.assignments.map(
      (item, assignmentIndex) => {
        if (
          !isRecord(item) ||
          typeof item.sourceLabel !== "string" ||
          !["one", "both", "needs-review"].includes(String(item.decision)) ||
          !Array.isArray(item.targetSlugs) ||
          !item.targetSlugs.every((slug) => typeof slug === "string") ||
          (item.rationale !== null && typeof item.rationale !== "string")
        )
          throw new Error(
            `Malformed artifact: rows[${index}].assignments[${assignmentIndex}] is invalid`,
          );
        return {
          sourceLabel: item.sourceLabel,
          decision: item.decision as SplitDecision,
          targetSlugs: item.targetSlugs as string[],
          rationale: item.rationale as string | null,
        };
      },
    );
    return {
      id: raw.id,
      slug: raw.slug,
      status: raw.status,
      name: raw.name,
      blurb: (raw.blurb ?? null) as string | null,
      description: (raw.description ?? null) as string | null,
      siteContent: raw.siteContent,
      productType: (raw.productType ?? null) as string | null,
      callId: raw.callId,
      sourceLabels: raw.sourceLabels as string[],
      before: {
        productTags: beforeTags as string[],
        productTagsEn: beforeEn as string[] | null,
        pairs: beforePairs,
      },
      after: {
        productTags: afterTags as string[],
        productTagsEn: afterEn as string[],
        pairs: afterPairs,
      },
      assignments,
      overflowReview: {
        status: overflowReview.status as OverflowReview["status"],
        candidates: overflowCandidates,
        evicted: overflowEvicted,
        rationale: overflowReview.rationale as string | null,
      },
    };
  });
  const planningCalls: PlanningCall[] = value.planningCalls.map(
    (raw, index) => {
      if (
        !isRecord(raw) ||
        typeof raw.callId !== "string" ||
        typeof raw.brandId !== "string" ||
        typeof raw.brandSlug !== "string" ||
        !Array.isArray(raw.sourceLabels) ||
        !raw.sourceLabels.every((label) => typeof label === "string") ||
        raw.operation !== PLANNING_OPERATION ||
        typeof raw.requestDigest !== "string"
      )
        throw new Error(
          `Malformed artifact: planningCalls[${index}] is invalid`,
        );
      return {
        callId: raw.callId,
        brandId: raw.brandId,
        brandSlug: raw.brandSlug,
        sourceLabels: raw.sourceLabels as string[],
        operation: PLANNING_OPERATION,
        requestDigest: raw.requestDigest,
      };
    },
  );
  const auditEvents = value.auditEvents.map((event, index) =>
    validateAuditEvent(event, index),
  );
  const rollbackRows = value.rollback.rows.map((raw, index) => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.slug !== "string" ||
      !Array.isArray(raw.productTags) ||
      !raw.productTags.every((tag) => typeof tag === "string") ||
      (raw.productTagsEn !== null &&
        (!Array.isArray(raw.productTagsEn) ||
          !raw.productTagsEn.every((tag) => typeof tag === "string")))
    )
      throw new Error(`Malformed artifact: rollback.rows[${index}] is invalid`);
    return {
      id: raw.id,
      slug: raw.slug,
      productTags: raw.productTags as string[],
      productTagsEn: raw.productTagsEn as string[] | null,
    };
  });
  const artifact = {
    version: RUN_ARTIFACT_VERSION,
    kind: ARTIFACT_KIND,
    createdAt: value.createdAt,
    operation: PLANNING_OPERATION,
    scope: {
      brandIds: value.scope.brandIds as string[],
      scopeHash: value.scope.scopeHash,
    },
    planningCalls,
    auditEvents,
    review: {
      status: value.review.status,
      reviewer: value.review.reviewer as string | null,
      reviewedAt: value.review.reviewedAt as string | null,
    },
    summary: value.summary as RunSummary,
    rows,
    rollback: {
      strategy: "restore-before-values" as const,
      rows: rollbackRows,
    },
  } satisfies RunArtifact;

  validateSplitRows(rows, { forApply: options.requireApproval });
  if (stableJson(artifact.summary) !== stableJson(summaryForRows(rows)))
    throw new Error("Malformed artifact: summary does not match row decisions");
  if (
    JSON.stringify(artifact.scope.brandIds) !==
    JSON.stringify(rows.map((row) => row.id).sort())
  )
    throw new Error("Malformed artifact: scope brand IDs do not match rows");
  if (artifact.scope.scopeHash !== calculateScopeHash(rows))
    throw new Error("Malformed artifact: scope hash does not match rows");
  if (
    rollbackRows.length !== rows.length ||
    rows.some(
      (row, index) =>
        rollbackRows[index]?.id !== row.id ||
        rollbackRows[index]?.slug !== row.slug ||
        !sameArray(
          rollbackRows[index]?.productTags ?? null,
          row.before.productTags,
        ) ||
        !sameArray(
          rollbackRows[index]?.productTagsEn ?? null,
          row.before.productTagsEn,
        ),
    )
  )
    throw new Error(
      "Malformed artifact: rollback does not restore before values",
    );
  assertPlanningAuditManifest(artifact, Boolean(options.requireApproval));
  if (
    options.requireApproval &&
    rows.some((row) => row.sourceLabels.length === 0)
  )
    throw new Error(
      "ABORT: approved artifact contains a row without a retired source label",
    );
  return artifact;
}

export function defaultArtifactPath(
  createdAt = new Date().toISOString(),
): string {
  return path.resolve(
    "scripts/eval/results",
    `split-composite-product-tags-${createdAt.replace(/[:.]/g, "-")}.json`,
  );
}

async function writeRunArtifact(artifact: RunArtifact): Promise<string> {
  const outputPath = defaultArtifactPath(artifact.createdAt);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return outputPath;
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
// Supabase boundary and apply guards
// ---------------------------------------------------------------------------

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey)
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  return createSupabaseClient(url, serviceRoleKey);
}

type SupabaseClient = ReturnType<typeof createServiceClient>;

function hasRetiredSource(tags: string[] | null): boolean {
  return (tags ?? []).some((tag) => sourceDefinitionForTag(tag) !== null);
}

async function loadCompositeBrands(
  supabase: SupabaseClient,
  batchSize: number,
): Promise<BrandRow[]> {
  const brands: BrandRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("brands")
      .select(
        "id, slug, status, name, blurb, description, site_content, product_type, product_tags, product_tags_en",
      )
      .eq("status", "approved")
      .not("product_tags", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as BrandRow[];
    brands.push(
      ...batch.filter((brand) => hasRetiredSource(brand.product_tags)),
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
    .select(
      "id, slug, status, name, blurb, description, site_content, product_type, product_tags, product_tags_en",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Brand ${id} no longer exists`);
  return data as unknown as BrandRow;
}

function assertCurrentMatchesArtifact(current: BrandRow, row: SplitRow): void {
  if (
    current.id !== row.id ||
    current.slug !== row.slug ||
    current.status !== row.status ||
    current.product_type !== row.productType ||
    current.name !== row.name ||
    current.blurb !== row.blurb ||
    current.description !== row.description ||
    stableJson(current.site_content) !== stableJson(row.siteContent) ||
    !sameArray(current.product_tags, row.before.productTags) ||
    !sameArray(current.product_tags_en, row.before.productTagsEn)
  ) {
    throw new Error(
      `ABORT: baseline drift for brand "${row.slug}"; current DB values do not match the reviewed artifact`,
    );
  }
}

function assertPersistedMatchesRow(current: BrandRow, row: SplitRow): void {
  if (
    current.id !== row.id ||
    current.slug !== row.slug ||
    current.status !== row.status ||
    current.product_type !== row.productType ||
    current.name !== row.name ||
    current.blurb !== row.blurb ||
    current.description !== row.description ||
    stableJson(current.site_content) !== stableJson(row.siteContent) ||
    !sameArray(current.product_tags, row.after.productTags) ||
    !sameArray(current.product_tags_en, row.after.productTagsEn) ||
    hasRetiredSource(current.product_tags)
  ) {
    throw new Error(
      `ABORT: final validation failed for brand "${row.slug}"; persisted values do not match the reviewed artifact`,
    );
  }
}

export function validateFinalSnapshots(
  rows: SplitRow[],
  snapshots: BrandRow[],
): void {
  if (snapshots.length !== rows.length)
    throw new Error(
      "ABORT: final validation did not re-read every artifact row",
    );
  const snapshotsById = new Map<string, BrandRow>();
  for (const snapshot of snapshots) {
    if (snapshotsById.has(snapshot.id))
      throw new Error(
        `ABORT: final validation returned duplicate brand "${snapshot.id}"`,
      );
    snapshotsById.set(snapshot.id, snapshot);
  }
  for (const row of rows) {
    const snapshot = snapshotsById.get(row.id);
    if (!snapshot)
      throw new Error(`ABORT: final validation is missing brand "${row.slug}"`);
    assertPersistedMatchesRow(snapshot, row);
  }
}

type ApplyBrandWriteResult = {
  productTags: string[];
  productTagsEn: string[] | null;
  productType: string | null;
  skipped: Array<{ field: string; reason: string }>;
};

type ApplyBrandUpdater = (
  id: string,
  data: { productTags: string[]; productTagsEn: string[] | null },
  actor: { source: "enriched"; jobId: string },
) => Promise<ApplyBrandWriteResult>;

export async function applyRunArtifact(
  supabase: SupabaseClient,
  artifact: RunArtifact,
  options: {
    batchSize?: number;
    revalidate?: (input: { slug: string }) => void | Promise<void>;
    loadScope?: (batchSize: number) => Promise<BrandRow[]>;
    loadSnapshot?: (id: string) => Promise<BrandRow>;
    update?: ApplyBrandUpdater;
  } = {},
): Promise<{ writeCount: number; revalidatedSlugs: string[] }> {
  const reviewed = parseRunArtifact(artifact, { requireApproval: true });
  const batchSize = options.batchSize ?? 50;
  const loadScope =
    options.loadScope ??
    ((size: number) => loadCompositeBrands(supabase, size));
  const loadSnapshot =
    options.loadSnapshot ?? ((id: string) => loadBrandSnapshot(supabase, id));
  const currentScope = await loadScope(batchSize);
  const currentScopeRows = currentScope.map((brand) => {
    const row = reviewed.rows.find((candidate) => candidate.id === brand.id);
    if (!row)
      throw new Error(
        `ABORT: source scope drift; brand "${brand.slug}" was not in the reviewed artifact`,
      );
    return buildSplitRow(brand, row.callId, row.assignments);
  });
  if (calculateScopeHash(currentScopeRows) !== reviewed.scope.scopeHash)
    throw new Error(
      "ABORT: global source scope drift; reviewed brand set changed before apply",
    );

  for (const row of reviewed.rows)
    assertCurrentMatchesArtifact(await loadSnapshot(row.id), row);

  let writeCount = 0;
  const changedRows = reviewed.rows.filter(
    (row) =>
      !sameArray(row.before.productTags, row.after.productTags) ||
      !sameArray(row.before.productTagsEn, row.after.productTagsEn),
  );
  const changedSlugs = changedRows.map((row) => row.slug);
  if (new Set(changedSlugs).size !== changedSlugs.length)
    throw new Error(
      "ABORT: reviewed artifact contains duplicate changed brand slugs",
    );
  const update =
    options.update ??
    ((await import("@/lib/services/brands")).updateBrand as ApplyBrandUpdater);
  for (const row of changedRows) {
    assertCurrentMatchesArtifact(await loadSnapshot(row.id), row);
    const written = await update(
      row.id,
      {
        productTags: row.after.productTags,
        productTagsEn: row.after.productTagsEn,
      },
      { source: "enriched", jobId: `dev-1361:${reviewed.createdAt}` },
    );
    if (written.skipped.length > 0)
      throw new Error(
        `ABORT: write for "${row.slug}" was skipped: ${written.skipped.map((entry) => `${entry.field}:${entry.reason}`).join(", ")}`,
      );
    if (
      !sameArray(written.productTags, row.after.productTags) ||
      !sameArray(written.productTagsEn, row.after.productTagsEn) ||
      written.productType !== row.productType
    )
      throw new Error(`ABORT: write verification failed for "${row.slug}"`);
    writeCount += 1;
  }

  const finalSnapshots: BrandRow[] = [];
  for (const row of reviewed.rows)
    finalSnapshots.push(await loadSnapshot(row.id));
  validateFinalSnapshots(reviewed.rows, finalSnapshots);

  const revalidate =
    options.revalidate ??
    (async ({ slug }: { slug: string }) => {
      const { revalidatePublicBrand } =
        await import("@/lib/cache/public-brand-cache");
      revalidatePublicBrand({ slug });
    });
  const revalidatedSlugs: string[] = [];
  for (const slug of changedSlugs) {
    try {
      await revalidate({ slug });
    } catch (error) {
      throw new Error(
        `ABORT: revalidation failed for "${slug}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    revalidatedSlugs.push(slug);
  }
  return { writeCount, revalidatedSlugs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function planAndWrite(options: CliOptions): Promise<void> {
  const supabase = createServiceClient();
  const auditEvents: ChatAuditEvent[] = [];
  const deepseek = createPlanningDeepSeekClient(auditEvents);
  const brands = await loadCompositeBrands(supabase, options.batchSize);
  const rows: SplitRow[] = [];
  const planningCalls: PlanningCall[] = [];

  for (const brand of brands) {
    const sourceLabels = sourceLabelsForTags(brand.product_tags ?? []);
    const callId = randomUUID();
    console.log(`[llm] classifying ${brand.slug}: ${sourceLabels.join(", ")}`);
    const classified = await classifyBrandWithLlm(
      deepseek,
      brand,
      sourceLabels,
      callId,
    );
    planningCalls.push(classified.planningCall);
    rows.push(buildSplitRow(brand, callId, classified.assignments));
  }

  const artifact = createRunArtifact(rows, planningCalls, auditEvents);
  const outputPath = await writeRunArtifact(artifact);
  console.log(`Run artifact written to ${outputPath}`);
  console.log(
    "Review every needs-review decision and aggregate distribution, then set review.status=approved, reviewer, and reviewedAt before applying.",
  );
  console.log(
    "For overflow rows, set overflowReview.status=approved, choose exact non-source before pairs in overflowReview.evicted, and update after.pairs/productTags/productTagsEn to the resulting 1-5 paired tags.",
  );
  console.log(JSON.stringify(artifact.summary, null, 2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) {
    const artifact = await readRunArtifact(options.artifactPath!, {
      requireApproval: true,
    });
    const result = await applyRunArtifact(createServiceClient(), artifact, {
      batchSize: options.batchSize,
    });
    console.log(`Applied ${result.writeCount} reviewed split update(s)`);
    console.log(
      `Revalidated changed brand slugs: ${result.revalidatedSlugs.join(", ") || "(none)"}`,
    );
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
