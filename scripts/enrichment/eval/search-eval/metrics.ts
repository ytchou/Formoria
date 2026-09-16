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
// Metric functions (precisionAtK, recallAtK, mrr, p95, mean) migrated to
// src/lib/services/eval/scorers.ts — import from there.
// ---------------------------------------------------------------------------

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
