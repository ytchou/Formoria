/**
 * Read-only validation report for a curated-product cohort run (DEV-1614).
 *
 *   pnpm exec tsx --env-file=.env.staging scripts/curated-products/validate-cohort.ts \
 *     --job-id <uuid>
 *
 * READ-ONLY — never writes to any table.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { parsePhaseResults } from "@/lib/services/phase-results";
import type { PhaseResult } from "@/lib/types/curation";
import { fetchAllRows } from "./shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  brand_id: string;
  url: string;
  title: string | null;
  supplier: string;
  image_url: string | null;
  llm_score: number | null;
  final_rank: number | null;
  llm_rationale: string | null;
};

export type JobTargetRow = {
  target_id: string;
  brand_slug: string | null;
  phase_results: unknown;
};

export type BrandRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
};

export type ImageProvenanceRow = {
  brand_slug: string;
  source_page: string | null;
};

export type CostSummary = {
  totalTokens: number;
  totalCostUsd: number;
};

export type ValidateCohortDeps = {
  fetchCandidates: (jobId: string) => Promise<CandidateRow[]>;
  fetchBrandsBySlugs: (slugs: string[]) => Promise<BrandRow[]>;
  fetchBrandsByIds: (ids: string[]) => Promise<BrandRow[]>;
  fetchCosts: (jobId: string) => Promise<CostSummary>;
  fetchJobTargets: (jobId: string) => Promise<JobTargetRow[]>;
  fetchSubmissionBrandIds: (submissionIds: string[]) => Promise<Array<{ id: string; brand_id: string }>>;
  fetchImageProvenance: (brandSlugs: string[]) => Promise<ImageProvenanceRow[]>;
};

type BrandReport = {
  slug: string;
  name: string;
  category: string;
  pool: number;
  scored: number;
  ranked: number;
  proposed: number;
  catalogZeroReason?: string;
  supplierBreakdown: Record<string, number>;
};

type OutcomeResult = {
  verdict: "GO" | "FIX" | "STOP";
  conditions: { label: string; passed: boolean; detail: string }[];
};

export type ValidationReport = {
  funnel: { pool: number; scored: number; ranked: number; proposed: number };
  brands: BrandReport[];
  provenance: Record<string, Record<string, number>>;
  gates: { zeroReasons: Record<string, string[]> };
  outcome: OutcomeResult;
  cost: CostSummary;
  categorySplit: Record<string, { brands: number; proposed: number }>;
  finalists: Array<{
    brand: string;
    url: string;
    title: string | null;
    imageUrl: string | null;
    score: number | null;
    rationale: string | null;
  }>;
  inconsistentBrands: string[];
};

// ---------------------------------------------------------------------------
// DEV-1613 baselines — expected minimum proposals per brand
// ---------------------------------------------------------------------------

const BASELINES: Record<string, number> = {
  aisaniea: 1,
  "yun-clean": 2,
  zenu: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function classifySupplier(supplier: string): string {
  if (supplier.startsWith("catalog:")) return "enumerated";
  if (supplier === "scraped") return "scraped";
  return "stored";
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export function computeOutcome(
  brandProposals: Map<string, number>,
  inconsistentSlugs: Set<string>,
): OutcomeResult {
  const conditions: OutcomeResult["conditions"] = [];
  const validBrands = new Map(
    [...brandProposals].filter(([slug]) => !inconsistentSlugs.has(slug)),
  );

  // Condition 1: ≥70% of brands have ≥1 proposal
  const withProposals = [...validBrands.values()].filter((n) => n > 0).length;
  const pct = validBrands.size > 0 ? withProposals / validBrands.size : 0;
  conditions.push({
    label: "≥70% brands with proposals",
    passed: pct >= 0.7,
    detail: `${withProposals}/${validBrands.size} (${(pct * 100).toFixed(0)}%)`,
  });

  // Condition 2: median proposals ≥ 1
  const proposalCounts = [...validBrands.values()];
  const med = median(proposalCounts);
  conditions.push({
    label: "median proposals ≥ 1",
    passed: med >= 1,
    detail: `median = ${med}`,
  });

  // Condition 3: no baseline regression
  let hasRegression = false;
  for (const [slug, baseline] of Object.entries(BASELINES)) {
    const actual = brandProposals.get(slug);
    if (actual !== undefined && actual < baseline) {
      hasRegression = true;
      conditions.push({
        label: `baseline ${slug}`,
        passed: false,
        detail: `expected ≥${baseline}, got ${actual}`,
      });
    }
  }
  if (!hasRegression) {
    conditions.push({
      label: "no baseline regression",
      passed: true,
      detail: "all baselines met or exceeded",
    });
  }

  // Condition 4: no data inconsistencies
  conditions.push({
    label: "no data inconsistencies",
    passed: inconsistentSlugs.size === 0,
    detail:
      inconsistentSlugs.size === 0
        ? "clean"
        : `${inconsistentSlugs.size} brand(s) flagged`,
  });

  const allPass = conditions.every((c) => c.passed);

  if (hasRegression) return { verdict: "STOP", conditions };
  if (allPass) return { verdict: "GO", conditions };
  return { verdict: "FIX", conditions };
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function validateCohort(
  jobId: string,
  deps: ValidateCohortDeps,
): Promise<ValidationReport> {
  const [candidates, targets] = await Promise.all([
    deps.fetchCandidates(jobId),
    deps.fetchJobTargets(jobId),
  ]);

  // Resolve brand slugs: use brand_slug when present, else look up via submissions
  const needsResolution = targets.filter((t) => !t.brand_slug);
  let submissionBrandMap = new Map<string, string>();
  if (needsResolution.length > 0) {
    const subIds = needsResolution.map((t) => t.target_id);
    const subs = await deps.fetchSubmissionBrandIds(subIds);
    submissionBrandMap = new Map(subs.map((s) => [s.id, s.brand_id]));
  }

  // Collect all brand_ids we need to look up
  const brandIdsFromSubs = [...new Set([...submissionBrandMap.values()])];
  const brandIdsFromCandidates = [...new Set(candidates.map((c) => c.brand_id))];
  const allBrandIds = [...new Set([...brandIdsFromSubs, ...brandIdsFromCandidates])];

  const [brands, cost] = await Promise.all([
    allBrandIds.length > 0 ? deps.fetchBrandsByIds(allBrandIds) : Promise.resolve([]),
    deps.fetchCosts(jobId),
  ]);

  const brandBySlug = new Map(brands.map((b) => [b.slug, b]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const brandIdToSlug = new Map(brands.map((b) => [b.id, b.slug]));

  // Resolve slug for each target
  for (const target of targets) {
    if (!target.brand_slug) {
      const brandId = submissionBrandMap.get(target.target_id);
      const brand = brandId ? brandById.get(brandId) : undefined;
      if (brand) (target as { brand_slug: string | null }).brand_slug = brand.slug;
    }
  }

  const brandSlugs = [...new Set(targets.map((t) => t.brand_slug).filter((s): s is string => s !== null))];

  const provenanceRows = brandSlugs.length > 0
    ? await deps.fetchImageProvenance(brandSlugs)
    : [];

  // Parse phase results per brand
  const brandPhaseResults = new Map<string, PhaseResult | undefined>();
  for (const target of targets) {
    const parsed = parsePhaseResults(target.phase_results as never);
    const productsPhase = parsed.find((p) => p.phase === "products");
    brandPhaseResults.set(target.brand_slug ?? target.target_id, productsPhase);
  }

  // Group candidates by brand slug (via brand_id → slug lookup)
  const candidatesBySlug = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    const slug = brandIdToSlug.get(c.brand_id) ?? c.brand_id;
    const list = candidatesBySlug.get(slug) ?? [];
    list.push(c);
    candidatesBySlug.set(slug, list);
  }

  // Consistency check
  const inconsistentBrands: string[] = [];
  const brandProposals = new Map<string, number>();

  const brandReports: BrandReport[] = [];
  const zeroReasons: Record<string, string[]> = {};
  const categorySplit: Record<string, { brands: number; proposed: number }> = {};
  const finalists: ValidationReport["finalists"] = [];

  // Provenance
  const provenance: Record<string, Record<string, number>> = {};
  for (const row of provenanceRows) {
    const slug = row.brand_slug;
    if (!provenance[slug]) provenance[slug] = {};
    const hasSource = row.source_page !== null;
    const key = hasSource ? "with_source" : "no_source";
    provenance[slug][key] = (provenance[slug][key] ?? 0) + 1;
  }

  // Per-brand supplier breakdown from candidates
  const supplierByBrand: Record<string, Record<string, number>> = {};
  for (const c of candidates) {
    const slug = brandIdToSlug.get(c.brand_id) ?? c.brand_id;
    if (!supplierByBrand[slug]) supplierByBrand[slug] = {};
    const cls = classifySupplier(c.supplier);
    supplierByBrand[slug][cls] = (supplierByBrand[slug][cls] ?? 0) + 1;
  }

  let totalPool = 0;
  let totalScored = 0;
  let totalRanked = 0;
  let totalProposed = 0;

  for (const target of targets) {
    const slug = target.brand_slug ?? target.target_id;
    const brand = brandBySlug.get(slug) ?? brandById.get(submissionBrandMap.get(target.target_id) ?? "");
    const brandCandidates = candidatesBySlug.get(slug) ?? [];
    const phaseResult = brandPhaseResults.get(slug);

    const pool = brandCandidates.length;
    const scored = brandCandidates.filter((c) => c.llm_score !== null).length;
    const ranked = brandCandidates.filter((c) => c.final_rank !== null).length;
    const proposed = phaseResult?.productsProposed ?? 0;

    // Consistency: proposals claimed but no candidates exist
    if (proposed > 0 && pool === 0) {
      inconsistentBrands.push(slug);
    }

    brandProposals.set(slug, proposed);

    totalPool += pool;
    totalScored += scored;
    totalRanked += ranked;
    totalProposed += proposed;

    const cat = brand?.category ?? "unknown";
    if (!categorySplit[cat]) categorySplit[cat] = { brands: 0, proposed: 0 };
    categorySplit[cat].brands++;
    categorySplit[cat].proposed += proposed;

    if (phaseResult?.catalogZeroReason) {
      const reason = phaseResult.catalogZeroReason;
      if (!zeroReasons[reason]) zeroReasons[reason] = [];
      zeroReasons[reason].push(slug);
    }

    // Finalists
    for (const c of brandCandidates.filter((r) => r.final_rank !== null)) {
      finalists.push({
        brand: slug,
        url: c.url,
        title: c.title,
        imageUrl: c.image_url,
        score: c.llm_score,
        rationale: c.llm_rationale,
      });
    }

    brandReports.push({
      slug,
      name: brand?.name ?? slug,
      category: cat,
      pool,
      scored,
      ranked,
      proposed,
      ...(phaseResult?.catalogZeroReason
        ? { catalogZeroReason: phaseResult.catalogZeroReason }
        : {}),
      supplierBreakdown: supplierByBrand[slug] ?? {},
    });
  }

  const outcome = computeOutcome(
    brandProposals,
    new Set(inconsistentBrands),
  );

  return {
    funnel: {
      pool: totalPool,
      scored: totalScored,
      ranked: totalRanked,
      proposed: totalProposed,
    },
    brands: brandReports,
    provenance,
    gates: { zeroReasons },
    outcome,
    cost,
    categorySplit,
    finalists,
    inconsistentBrands,
  };
}

// ---------------------------------------------------------------------------
// Printer
// ---------------------------------------------------------------------------

function printReport(report: ValidationReport): void {
  console.log("\n=== CURATED-PRODUCT VALIDATION REPORT ===\n");

  // 1. Funnel
  console.log("## Funnel");
  console.log(`  Pool:     ${report.funnel.pool}`);
  console.log(`  Scored:   ${report.funnel.scored}`);
  console.log(`  Ranked:   ${report.funnel.ranked}`);
  console.log(`  Proposed: ${report.funnel.proposed}`);

  // 2. Per-brand
  console.log("\n## Per-brand");
  console.log(
    "  slug".padEnd(30) +
      "pool".padStart(6) +
      "scored".padStart(8) +
      "ranked".padStart(8) +
      "proposed".padStart(10) +
      "  zero-reason",
  );
  for (const b of report.brands) {
    console.log(
      `  ${b.slug.padEnd(28)}${String(b.pool).padStart(6)}${String(b.scored).padStart(8)}${String(b.ranked).padStart(8)}${String(b.proposed).padStart(10)}  ${b.catalogZeroReason ?? "—"}`,
    );
  }

  // 3. Provenance
  console.log("\n## Provenance (image source_page)");
  for (const [slug, counts] of Object.entries(report.provenance)) {
    console.log(`  ${slug}: ${JSON.stringify(counts)}`);
  }

  // 4. Zero-product reasons
  console.log("\n## Zero-product reasons");
  for (const [reason, slugs] of Object.entries(report.gates.zeroReasons)) {
    console.log(`  ${reason}: ${slugs.join(", ")}`);
  }

  // 5. Category split
  console.log("\n## Category split");
  for (const [cat, { brands, proposed }] of Object.entries(
    report.categorySplit,
  )) {
    console.log(`  ${cat}: ${brands} brand(s), ${proposed} proposed`);
  }

  // 6. Cost
  console.log("\n## Cost");
  console.log(`  Tokens: ${report.cost.totalTokens}`);
  console.log(`  USD:    $${report.cost.totalCostUsd.toFixed(4)}`);

  // 7. Outcome
  console.log("\n## Outcome");
  console.log(`  Verdict: ${report.outcome.verdict}`);
  for (const c of report.outcome.conditions) {
    console.log(`  ${c.passed ? "PASS" : "FAIL"} ${c.label} — ${c.detail}`);
  }

  // 8. Inconsistencies
  if (report.inconsistentBrands.length > 0) {
    console.log("\n## DATA INCONSISTENCIES");
    for (const slug of report.inconsistentBrands) {
      console.log(
        `  ${slug}: productsProposed > 0 but 0 candidate rows`,
      );
    }
  }

  // 9. Finalist proposals
  if (report.finalists.length > 0) {
    console.log("\n## Finalist proposals (ranked candidates)");
    for (const f of report.finalists) {
      console.log(
        `  [${f.brand}] ${f.url} — ${f.title ?? "(no title)"} | score=${f.score} | ${f.rationale ?? ""}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Real deps (Supabase)
// ---------------------------------------------------------------------------

function createRealDeps(): ValidateCohortDeps {
  const supabase = createServiceClient();

  return {
    fetchCandidates: (jobId) =>
      fetchAllRows<CandidateRow>("curated_product_candidates", (from, to) =>
        supabase
          .from("curated_product_candidates")
          .select("id, brand_id, url, title, supplier, image_url, llm_score, final_rank, llm_rationale")
          .eq("job_id", jobId)
          .order("brand_id")
          .range(from, to),
      ),

    fetchBrandsBySlugs: (slugs) =>
      fetchAllRows<BrandRow>("brands", (from, to) =>
        supabase
          .from("brands")
          .select("id, slug, name, category")
          .in("slug", slugs)
          .order("slug")
          .range(from, to),
      ),

    fetchBrandsByIds: (ids) =>
      fetchAllRows<BrandRow>("brands", (from, to) =>
        supabase
          .from("brands")
          .select("id, slug, name, category")
          .in("id", ids)
          .order("slug")
          .range(from, to),
      ),

    fetchCosts: async (jobId) => {
      const { data } = await supabase
        .from("external_call_audit")
        .select("prompt_tokens, completion_tokens, cost_usd")
        .eq("job_id", jobId);

      let totalTokens = 0;
      let totalCostUsd = 0;
      for (const row of data ?? []) {
        const r = row as Record<string, number>;
        totalTokens += (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
        totalCostUsd += r.cost_usd ?? 0;
      }
      return { totalTokens, totalCostUsd };
    },

    fetchJobTargets: (jobId) =>
      fetchAllRows<JobTargetRow>("curation_job_targets", (from, to) =>
        supabase
          .from("curation_job_targets")
          .select("target_id, brand_slug, phase_results")
          .eq("job_id", jobId)
          .order("brand_slug")
          .range(from, to),
      ),

    fetchSubmissionBrandIds: async (submissionIds) => {
      const { data, error } = await supabase
        .from("brand_submissions")
        .select("id, brand_id")
        .in("id", submissionIds);
      if (error) throw new Error(`failed to read brand_submissions: ${error.message}`);
      return (data ?? []) as Array<{ id: string; brand_id: string }>;
    },

    fetchImageProvenance: (brandSlugs) =>
      fetchAllRows<ImageProvenanceRow>(
        "brand_image_provenance",
        (from, to) =>
          supabase
            .from("brand_image_provenance")
            .select("brand_slug, source_page")
            .in("brand_slug", brandSlugs)
            .order("brand_slug")
            .range(from, to),
      ),
  };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const jobIdArg = process.argv[1];
if (jobIdArg === undefined) {
  // Running as a module import (tests), not CLI
} else if (process.argv.includes("--job-id")) {
  const idx = process.argv.indexOf("--job-id");
  const jobId = process.argv[idx + 1];
  if (!jobId) {
    console.error("Usage: validate-cohort.ts --job-id <uuid>");
    process.exit(2);
  }

  const deps = createRealDeps();
  validateCohort(jobId, deps).then((report) => {
    printReport(report);
    process.exit(report.outcome.verdict === "GO" ? 0 : 1);
  });
}
