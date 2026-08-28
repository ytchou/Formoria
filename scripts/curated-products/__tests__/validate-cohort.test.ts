import { describe, expect, it } from "vitest";
import {
  validateCohort,
  computeOutcome,
  median,
  classifySupplier,
  type ValidateCohortDeps,
  type CandidateRow,
  type JobTargetRow,
} from "../validate-cohort";

function makeDeps(overrides: Partial<ValidateCohortDeps> = {}): ValidateCohortDeps {
  return {
    fetchCandidates: async () => [],
    fetchBrandsBySlugs: async () => [],
    fetchBrandsByIds: async () => [],
    fetchCosts: async () => ({ totalTokens: 0, totalCostUsd: 0 }),
    fetchJobTargets: async () => [],
    fetchSubmissionBrandIds: async () => [],
    fetchImageProvenance: async () => [],
    ...overrides,
  };
}

function candidateRow(
  overrides: Partial<CandidateRow> = {},
): CandidateRow {
  return {
    id: "c1",
    brand_id: "b1",
    url: "https://example.com/products/a",
    title: "Product A",
    supplier: "catalog:shopline",
    image_url: "https://example.com/img/a.jpg",
    llm_score: 0.9,
    final_rank: 1,
    llm_rationale: "Good product",
    ...overrides,
  };
}

function targetRow(
  overrides: Partial<JobTargetRow> = {},
): JobTargetRow {
  return {
    target_id: "s1",
    brand_slug: "brand-a",
    phase_results: [
      {
        phase: "products",
        status: "succeeded",
        changedFields: ["products"],
        durationMs: 500,
        productsProposed: 2,
      },
    ],
    ...overrides,
  };
}

describe("validateCohort", () => {
  it("computes four-stage funnel correctly", async () => {
    const candidates: CandidateRow[] = [
      candidateRow({ id: "c1", brand_id: "b1", llm_score: 0.9, final_rank: 1 }),
      candidateRow({ id: "c2", brand_id: "b1", llm_score: 0.5, final_rank: null }),
      candidateRow({ id: "c3", brand_id: "b1", llm_score: null, final_rank: null }),
    ];
    const targets: JobTargetRow[] = [
      targetRow({
        target_id: "s1",
        brand_slug: "brand-a",
        phase_results: [
          {
            phase: "products",
            status: "succeeded",
            changedFields: ["products"],
            durationMs: 500,
            productsProposed: 1,
          },
        ],
      }),
    ];

    const report = await validateCohort("job-1", makeDeps({
      fetchCandidates: async () => candidates,
      fetchJobTargets: async () => targets,
      fetchBrandsByIds: async () => [{ id: "b1", slug: "brand-a", name: "Brand A", category: "home" }],
    }));

    expect(report.funnel.pool).toBe(3);
    expect(report.funnel.scored).toBe(2);
    expect(report.funnel.ranked).toBe(1);
    expect(report.funnel.proposed).toBe(1);
  });

  it("groups provenance by supplier class", () => {
    expect(classifySupplier("catalog:shopline")).toBe("enumerated");
    expect(classifySupplier("catalog:91app")).toBe("enumerated");
    expect(classifySupplier("acquisition")).toBe("stored");
    expect(classifySupplier("scraped")).toBe("scraped");
    expect(classifySupplier("stored")).toBe("stored");
  });

  it("computes median correctly for odd count", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });

  it("computes median correctly for even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("outcome criteria pass when all conditions met", () => {
    const brandProposals = new Map([
      ["aisaniea", 2],
      ["yun-clean", 3],
      ["zenu", 1],
      ["brand-a", 2],
      ["brand-b", 1],
    ]);

    const result = computeOutcome(brandProposals, new Set());
    expect(result.verdict).toBe("GO");
  });

  it("outcome criteria fail on regression", () => {
    const brandProposals = new Map([
      ["aisaniea", 0],
      ["yun-clean", 3],
      ["zenu", 1],
      ["brand-a", 2],
    ]);

    const result = computeOutcome(brandProposals, new Set());
    expect(result.verdict).toBe("STOP");
  });

  it("handles empty job gracefully", async () => {
    const report = await validateCohort("job-1", makeDeps());
    expect(report.funnel.pool).toBe(0);
    expect(report.outcome.verdict).toBe("FIX");
  });

  it("flags consistency error when productsProposed > 0 but no candidate rows", async () => {
    const targets: JobTargetRow[] = [
      targetRow({
        target_id: "s1",
        brand_slug: "brand-a",
        phase_results: [
          {
            phase: "products",
            status: "succeeded",
            changedFields: ["products"],
            durationMs: 500,
            productsProposed: 3,
          },
        ],
      }),
    ];

    const report = await validateCohort("job-1", makeDeps({
      fetchJobTargets: async () => targets,
      fetchBrandsByIds: async () => [{ id: "b1", slug: "brand-a", name: "Brand A", category: "home" }],
    }));

    expect(report.inconsistentBrands).toContain("brand-a");
    expect(report.outcome.verdict).toBe("FIX");
  });
});
