import { describe, expect, it } from "vitest";
import { precisionAtK, recallAtK, mrr, verdict, resolveExpected, type ArmResult } from "../metrics";

describe("precisionAtK", () => {
  it("returns fraction of retrieved items that are relevant", () => {
    // 3 retrieved, 2 relevant in top-3 => 2/3
    expect(precisionAtK(["a", "b", "c", "d"], ["a", "c"], 3)).toBeCloseTo(
      2 / 3,
    );
  });

  it("returns 0 when nothing is relevant (zero-hit)", () => {
    expect(precisionAtK(["x", "y", "z"], ["a", "b"], 3)).toBe(0);
  });

  it("handles duplicate keys in retrieved — counts each match once", () => {
    // "a" appears twice in retrieved, but only one intersection with expected
    expect(precisionAtK(["a", "a", "b"], ["a"], 3)).toBeCloseTo(2 / 3);
  });

  it("returns 0 when k is 0", () => {
    expect(precisionAtK(["a"], ["a"], 0)).toBe(0);
  });
});

describe("recallAtK", () => {
  it("returns fraction of expected items found in top-k", () => {
    // expected = [a, b, c], retrieved top-3 has a, c => 2/3
    expect(recallAtK(["a", "x", "c", "b"], ["a", "b", "c"], 3)).toBeCloseTo(
      2 / 3,
    );
  });

  it("returns 0 when nothing is relevant (zero-hit)", () => {
    expect(recallAtK(["x", "y"], ["a", "b"], 2)).toBe(0);
  });

  it("returns 0 when expected is empty", () => {
    expect(recallAtK(["a", "b"], [], 2)).toBe(0);
  });
});

describe("mrr", () => {
  it("returns 1/rank of first expected item in retrieved", () => {
    // "b" is at index 1 (rank 2) => 1/2
    expect(mrr(["x", "b", "a"], ["a", "b"])).toBeCloseTo(0.5);
  });

  it("returns 0 when no expected item is found (zero-hit)", () => {
    expect(mrr(["x", "y", "z"], ["a", "b"])).toBe(0);
  });

  it("returns 1 when the first retrieved is expected", () => {
    expect(mrr(["a", "b"], ["a"])).toBe(1);
  });
});

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
