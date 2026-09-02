// ---------------------------------------------------------------------------
// Golden set types
// ---------------------------------------------------------------------------

export type GoldenItem = {
  id: string;
  query: string;
  category?: string;
  expected: Array<{ brandSlug: string; productKey: string }>;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryResult = {
  queryId: string;
  retrieved: string[];
  expected: string[];
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  latencyMs: number;
};

export type ArmResult = {
  arm: string;
  metrics: {
    meanPrecisionAtK: number;
    meanRecallAtK: number;
    meanMrr: number;
    p95LatencyMs: number;
  };
  perQuery: QueryResult[];
};

// ---------------------------------------------------------------------------
// Metric functions
// ---------------------------------------------------------------------------

/**
 * Precision@k: fraction of the top-k retrieved items that are in the expected set.
 */
export function precisionAtK(
  retrieved: string[],
  expected: string[],
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = retrieved.slice(0, k);
  const expectedSet = new Set(expected);
  const hits = topK.filter((id) => expectedSet.has(id)).length;
  return hits / k;
}

/**
 * Recall@k: fraction of expected items found in the top-k retrieved items.
 */
export function recallAtK(
  retrieved: string[],
  expected: string[],
  k: number,
): number {
  if (expected.length === 0) return 0;
  const topK = new Set(retrieved.slice(0, k));
  const hits = expected.filter((id) => topK.has(id)).length;
  return hits / expected.length;
}

/**
 * Mean Reciprocal Rank: 1 / (rank of the first expected item in retrieved).
 * Returns 0 when no expected item appears in retrieved.
 */
export function mrr(retrieved: string[], expected: string[]): number {
  const expectedSet = new Set(expected);
  for (let i = 0; i < retrieved.length; i++) {
    if (expectedSet.has(retrieved[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Decides whether the rerank arm should ship.
 *
 * - "ship": rerank precision@5 improves by >= 0.1 over hybrid AND p95 < 1500ms
 * - "no-lift": precision improvement < 0.1
 * - "too-slow": p95 >= 1500ms despite sufficient lift
 * - "missing-arms": hybrid or rerank arm not present
 */
export function verdict(results: ArmResult[]): string {
  const hybrid = results.find((r) => r.arm === "hybrid");
  const rerank = results.find((r) => r.arm === "rerank");

  if (!hybrid || !rerank) return "missing-arms";

  const lift =
    rerank.metrics.meanPrecisionAtK - hybrid.metrics.meanPrecisionAtK;
  const fast = rerank.metrics.p95LatencyMs < 1500;

  if (lift >= 0.1 - 1e-9 && fast) return "ship";
  if (lift < 0.1 - 1e-9) return "no-lift";
  return "too-slow";
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)]!;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// resolveExpected — pure over injected lookup
// ---------------------------------------------------------------------------

type ProductEntry = { id: string; key: string; brandSlug: string };

/**
 * Resolve expected brandSlug+productKey pairs to product IDs.
 *
 * The `lookupFn` parameter allows injection for testing. In production the
 * eval script passes a function that queries the catalog.
 */
export async function resolveExpected(
  items: GoldenItem[],
  lookupFn: (
    slugs: string[],
  ) => Promise<Map<string, ProductEntry>>,
): Promise<{
  resolved: Map<string, string[]>;
  missing: Array<{ queryId: string; brandSlug: string; productKey: string }>;
}> {
  const allSlugs = new Set<string>();
  for (const item of items) {
    for (const exp of item.expected) {
      allSlugs.add(exp.brandSlug);
    }
  }

  const productMap = await lookupFn([...allSlugs]);

  const resolved = new Map<string, string[]>();
  const missing: Array<{
    queryId: string;
    brandSlug: string;
    productKey: string;
  }> = [];

  for (const item of items) {
    const ids: string[] = [];
    for (const exp of item.expected) {
      const compositeKey = `${exp.brandSlug}:${exp.productKey}`;
      const found = productMap.get(compositeKey);
      if (found) {
        ids.push(found.id);
      } else {
        missing.push({
          queryId: item.id,
          brandSlug: exp.brandSlug,
          productKey: exp.productKey,
        });
      }
    }
    resolved.set(item.id, ids);
  }

  return { resolved, missing };
}
