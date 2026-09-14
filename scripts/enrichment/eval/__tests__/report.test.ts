import { describe, expect, it } from "vitest";

import {
  type BrandRow,
  aggregate,
  percentile,
  resolveVerdict,
} from "../report";

// ---------------------------------------------------------------------------
// resolveVerdict — verdict matrix
// ---------------------------------------------------------------------------

describe("resolveVerdict", () => {
  // expected null → mismatch
  it("expected null (holdout) → mismatch", () => {
    const v = resolveVerdict(null, "success_products");
    expect(v.verdict).toBe("mismatch");
  });

  // expected correct_zero
  it("expected correct_zero + observed zero:no_catalog → correct", () => {
    const v = resolveVerdict("correct_zero", "zero:no_catalog");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("correct_zero");
  });

  it("expected correct_zero + observed unsupported_source_shape → correct", () => {
    const v = resolveVerdict("correct_zero", "unsupported_source_shape");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("correct_zero");
  });

  it("expected correct_zero + observed render_required → correct", () => {
    const v = resolveVerdict("correct_zero", "render_required");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("correct_zero");
  });

  it("expected correct_zero + observed zero:unclassified → correct", () => {
    const v = resolveVerdict("correct_zero", "zero:unclassified");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("correct_zero");
  });

  it("expected correct_zero + observed success_products → improvement", () => {
    const v = resolveVerdict("correct_zero", "success_products");
    expect(v.verdict).toBe("improvement");
    expect(v.observedNormalized).toBe("success_products");
  });

  it("expected correct_zero + observed transient_infra_failure → mismatch", () => {
    const v = resolveVerdict("correct_zero", "transient_infra_failure");
    expect(v.verdict).toBe("mismatch");
  });

  // expected data_defect
  it("expected data_defect + observed zero:no_catalog → correct", () => {
    const v = resolveVerdict("data_defect", "zero:no_catalog");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("data_defect");
  });

  it("expected data_defect + observed extraction_failure → correct", () => {
    const v = resolveVerdict("data_defect", "extraction_failure");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("data_defect");
  });

  it("expected data_defect + observed success_products → improvement", () => {
    const v = resolveVerdict("data_defect", "success_products");
    expect(v.verdict).toBe("improvement");
    expect(v.observedNormalized).toBe("success_products");
  });

  it("expected data_defect + observed transient_infra_failure → mismatch", () => {
    const v = resolveVerdict("data_defect", "transient_infra_failure");
    expect(v.verdict).toBe("mismatch");
  });

  // expected success_products
  it("expected success_products + observed success_products → correct", () => {
    const v = resolveVerdict("success_products", "success_products");
    expect(v.verdict).toBe("correct");
    expect(v.observedNormalized).toBe("success_products");
  });

  it("expected success_products + observed zero:no_catalog → regression", () => {
    const v = resolveVerdict("success_products", "zero:no_catalog");
    expect(v.verdict).toBe("regression");
  });

  it("expected success_products + observed transient_infra_failure → regression", () => {
    const v = resolveVerdict("success_products", "transient_infra_failure");
    expect(v.verdict).toBe("regression");
  });

  it("expected success_products + observed extraction_failure → regression", () => {
    const v = resolveVerdict("success_products", "extraction_failure");
    expect(v.verdict).toBe("regression");
  });
});

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

describe("percentile", () => {
  it("p50=200, p95=300 for [100, 200, 300]", () => {
    expect(percentile([100, 200, 300], 50)).toBe(200);
    expect(percentile([100, 200, 300], 95)).toBeCloseTo(290, 0);
  });

  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single value for a 1-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

function makeBrandRow(overrides: Partial<BrandRow> = {}): BrandRow {
  return {
    slug: "test",
    group: "opt10",
    tags: [],
    expected: "success_products",
    observed: "success_products",
    verdict: "correct",
    stage: "products",
    evidence: [],
    products: {
      proposed: 3,
      verified: 3,
      repaired: 0,
      dropped: 0,
      dropReasons: [],
    },
    llm: {
      calls: 2,
      promptTokens: 1000,
      completionTokens: 200,
      costUsd: 0.05,
      unpricedTurns: 0,
    },
    durationMs: 5000,
    phaseDurations: {},
    ...overrides,
  };
}

describe("aggregate", () => {
  it("computes correctOutcomeRate, regressions, and cost totals", () => {
    const rows: BrandRow[] = [
      makeBrandRow({
        slug: "brand-a",
        verdict: "correct",
        llm: { calls: 1, promptTokens: 100, completionTokens: 10, costUsd: 0.10, unpricedTurns: 0 },
        durationMs: 1000,
      }),
      makeBrandRow({
        slug: "brand-b",
        verdict: "correct",
        llm: { calls: 1, promptTokens: 200, completionTokens: 20, costUsd: 0.20, unpricedTurns: 0 },
        durationMs: 2000,
      }),
      makeBrandRow({
        slug: "brand-c",
        verdict: "regression",
        observed: "extraction_failure",
        stage: "products",
        llm: { calls: 1, promptTokens: 50, completionTokens: 5, costUsd: 0.05, unpricedTurns: 0 },
        durationMs: 3000,
      }),
    ];

    const agg = aggregate(rows);

    expect(agg.attempted).toBe(3);
    expect(agg.correctOutcomeRate).toBeCloseTo(2 / 3, 4);
    expect(agg.regressions).toEqual(["brand-c"]);
    expect(agg.improvements).toEqual([]);
    expect(agg.cost.total).toBeCloseTo(0.35, 4);
    expect(agg.cost.perAttempted).toBeCloseTo(0.35 / 3, 4);
    expect(agg.cost.perCorrect).toBeCloseTo(0.35 / 2, 4);
  });

  it("counts transient retries", () => {
    const rows: BrandRow[] = [
      makeBrandRow({
        slug: "a",
        observed: "transient_infra_failure",
        verdict: "mismatch",
        expected: null,
        stage: "infra",
      }),
      makeBrandRow({ slug: "b" }),
    ];

    expect(aggregate(rows).transientRetries).toBe(1);
  });

  it("handles empty rows", () => {
    const agg = aggregate([]);
    expect(agg.attempted).toBe(0);
    expect(agg.correctOutcomeRate).toBe(0);
    expect(agg.cost.total).toBe(0);
    expect(agg.latencyMs.p50).toBe(0);
  });

  it("computes sub-rates for expected outcome groups", () => {
    const rows: BrandRow[] = [
      makeBrandRow({
        slug: "s1",
        expected: "success_products",
        observed: "success_products",
        verdict: "correct",
      }),
      makeBrandRow({
        slug: "s2",
        expected: "success_products",
        observed: "extraction_failure",
        verdict: "regression",
        stage: "products",
      }),
      makeBrandRow({
        slug: "z1",
        expected: "correct_zero",
        observed: "zero:no_catalog",
        verdict: "correct",
        stage: "catalog",
      }),
    ];

    const agg = aggregate(rows);
    // 1 of 2 expected-success brands correct
    expect(agg.successRateOnExpectedSuccess).toBeCloseTo(0.5, 4);
    // 1 of 1 expected-correct_zero brands correct
    expect(agg.correctZeroRate).toBeCloseTo(1.0, 4);
  });
});
