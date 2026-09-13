/**
 * @formoria-script
 * purpose: Resolve verdicts (expected vs observed) and aggregate eval-run statistics.
 * class: shared
 * invoke: pnpm exec tsx scripts/enrichment/eval/report.ts
 * target: none
 * safety: read-only
 * owner: engineering
 */
import type { Expected } from "./manifest";
import type { Observed } from "./classify";

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const VERDICTS = [
  "correct",
  "regression",
  "improvement",
  "mismatch",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type ResolvedVerdict = {
  verdict: Verdict;
  /** e.g. 'correct_zero' when zero:* maps to correct_zero */
  observedNormalized: string;
};

/**
 * Maps an observed zero:* outcome (or neighbours like render_required,
 * unsupported_source_shape) to the normalized "correct_zero" bucket.
 */
function isCorrectZeroObserved(observed: Observed): boolean {
  return (
    observed.startsWith("zero:") ||
    observed === "unsupported_source_shape" ||
    observed === "render_required"
  );
}

export function resolveVerdict(
  expected: Expected | null,
  observed: Observed,
): ResolvedVerdict {
  // Holdout / unlabeled — always mismatch
  if (expected === null) {
    return { verdict: "mismatch", observedNormalized: observed };
  }

  // --- expected: correct_zero ---
  if (expected === "correct_zero") {
    if (isCorrectZeroObserved(observed)) {
      return { verdict: "correct", observedNormalized: "correct_zero" };
    }
    if (observed === "success_products") {
      return { verdict: "improvement", observedNormalized: "success_products" };
    }
    // transient or anything else
    return { verdict: "mismatch", observedNormalized: observed };
  }

  // --- expected: data_defect ---
  if (expected === "data_defect") {
    if (observed === "success_products") {
      return { verdict: "improvement", observedNormalized: "success_products" };
    }
    if (observed === "transient_infra_failure") {
      return { verdict: "mismatch", observedNormalized: observed };
    }
    // Everything else counts as the defect being correctly detected
    return { verdict: "correct", observedNormalized: "data_defect" };
  }

  // --- expected: success_products ---
  if (expected === "success_products") {
    if (observed === "success_products") {
      return { verdict: "correct", observedNormalized: "success_products" };
    }
    return { verdict: "regression", observedNormalized: observed };
  }

  // Unreachable for valid Expected values
  return { verdict: "mismatch", observedNormalized: observed };
}

// ---------------------------------------------------------------------------
// Brand row (per-brand eval result)
// ---------------------------------------------------------------------------

export type BrandRow = {
  slug: string;
  group: string;
  tags: string[];
  expected: string | null;
  observed: string;
  verdict: Verdict;
  stage: string;
  evidence: string[];
  products: {
    proposed: number;
    verified: number;
    repaired: number;
    dropped: number;
    dropReasons: string[];
  };
  llm: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    unpricedTurns: number;
  };
  durationMs: number;
  phaseDurations: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type Aggregate = {
  attempted: number;
  correctOutcomeRate: number;
  correctZeroRate: number;
  dataDefectRate: number;
  successRateOnExpectedSuccess: number;
  regressions: string[];
  improvements: string[];
  failureByStage: Record<string, number>;
  observedCounts: Record<string, number>;
  cost: { total: number; perAttempted: number; perCorrect: number };
  latencyMs: { p50: number; p95: number; max: number };
  rendersTotal: number;
  fetchesTotal: number;
  transientRetries: number;
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

export function aggregate(rows: BrandRow[]): Aggregate {
  const attempted = rows.length;

  const correct = rows.filter((r) => r.verdict === "correct");
  const regressions = rows
    .filter((r) => r.verdict === "regression")
    .map((r) => r.slug);
  const improvements = rows
    .filter((r) => r.verdict === "improvement")
    .map((r) => r.slug);

  // Per-expected-outcome rates
  const expectedCorrectZero = rows.filter(
    (r) => r.expected === "correct_zero",
  );
  const expectedDataDefect = rows.filter(
    (r) => r.expected === "data_defect",
  );
  const expectedSuccess = rows.filter(
    (r) => r.expected === "success_products",
  );

  const correctZeroCorrect = expectedCorrectZero.filter(
    (r) => r.verdict === "correct",
  );
  const dataDefectCorrect = expectedDataDefect.filter(
    (r) => r.verdict === "correct",
  );
  const successCorrect = expectedSuccess.filter(
    (r) => r.verdict === "correct",
  );

  // Failure-by-stage (non-correct rows only)
  const failureByStage: Record<string, number> = {};
  for (const row of rows) {
    if (row.verdict !== "correct") {
      failureByStage[row.stage] = (failureByStage[row.stage] ?? 0) + 1;
    }
  }

  // Observed counts
  const observedCounts: Record<string, number> = {};
  for (const row of rows) {
    observedCounts[row.observed] = (observedCounts[row.observed] ?? 0) + 1;
  }

  // Cost
  const totalCost = rows.reduce((sum, r) => sum + r.llm.costUsd, 0);
  const correctCount = correct.length;

  // Latency
  const durations = rows.map((r) => r.durationMs);

  // Transient retries
  const transientRetries = rows.filter(
    (r) => r.observed === "transient_infra_failure",
  ).length;

  return {
    attempted,
    correctOutcomeRate: attempted > 0 ? correct.length / attempted : 0,
    correctZeroRate:
      expectedCorrectZero.length > 0
        ? correctZeroCorrect.length / expectedCorrectZero.length
        : 0,
    dataDefectRate:
      expectedDataDefect.length > 0
        ? dataDefectCorrect.length / expectedDataDefect.length
        : 0,
    successRateOnExpectedSuccess:
      expectedSuccess.length > 0
        ? successCorrect.length / expectedSuccess.length
        : 0,
    regressions,
    improvements,
    failureByStage,
    observedCounts,
    cost: {
      total: totalCost,
      perAttempted: attempted > 0 ? totalCost / attempted : 0,
      perCorrect: correctCount > 0 ? totalCost / correctCount : 0,
    },
    latencyMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.length > 0 ? Math.max(...durations) : 0,
    },
    rendersTotal: 0,
    fetchesTotal: 0,
    transientRetries,
  };
}
