import { describe, expect, it } from "vitest";
import { verdict, resolveExpected, type ArmResult } from "../metrics";

// precisionAtK, recallAtK, mrr, p95, mean migrated to src/lib/services/eval/scorers.ts
// — their tests live in scorers.test.ts now.

describe("verdict", () => {
  function arm(
    name: string,
    precisionAt5: number,
    p95Ms: number,
  ): ArmResult {
    return {
      arm: name,
      metrics: {
        meanPrecisionAtK: precisionAt5,
        meanRecallAtK: 0.5,
        meanMrr: 0.5,
        p95LatencyMs: p95Ms,
      },
      perQuery: [],
    };
  }

  it('returns "ship" when rerank precision improves by >= 0.1 and p95 < 1500ms', () => {
    const results: ArmResult[] = [
      arm("hybrid", 0.4, 200),
      arm("rerank", 0.5, 1000),
    ];
    expect(verdict(results)).toBe("ship");
  });

  it('returns "no-lift" when rerank precision improvement < 0.1', () => {
    const results: ArmResult[] = [
      arm("hybrid", 0.4, 200),
      arm("rerank", 0.45, 500),
    ];
    expect(verdict(results)).toBe("no-lift");
  });

  it('returns "too-slow" when p95 >= 1500ms even with good precision lift', () => {
    const results: ArmResult[] = [
      arm("hybrid", 0.3, 200),
      arm("rerank", 0.5, 1600),
    ];
    expect(verdict(results)).toBe("too-slow");
  });

  it('returns "missing-arms" when hybrid or rerank arm is absent', () => {
    const results: ArmResult[] = [arm("hybrid", 0.4, 200)];
    expect(verdict(results)).toBe("missing-arms");
  });
});

describe("resolveExpected", () => {
  it("maps brandSlug+productKey to product ids and reports missing keys", async () => {
    const items = [
      {
        id: "q1",
        query: "test query",
        expected: [
          { brandSlug: "brand-a", productKey: "product-1" },
          { brandSlug: "brand-a", productKey: "product-missing" },
        ],
      },
    ];

    // Injected lookup: only brand-a:product-1 exists
    const lookup = async (_slugs: string[]) => {
      const map = new Map<
        string,
        { id: string; key: string; brandSlug: string }
      >();
      map.set("brand-a:product-1", {
        id: "uuid-1",
        key: "product-1",
        brandSlug: "brand-a",
      });
      return map;
    };

    const { resolved, missing } = await resolveExpected(items, lookup);

    expect(resolved.get("q1")).toEqual(["uuid-1"]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toEqual({
      queryId: "q1",
      brandSlug: "brand-a",
      productKey: "product-missing",
    });
  });
});
