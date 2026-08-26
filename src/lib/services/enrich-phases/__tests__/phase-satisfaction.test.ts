import { describe, it, expect } from "vitest";
import {
  checkPhaseSatisfaction,
  type PhaseSatisfactionData,
} from "../phase-satisfaction";

function makeData(
  overrides: Partial<PhaseSatisfactionData> = {},
): PhaseSatisfactionData {
  return {
    brand: {
      purchase_website: null,
      website: null,
      description: null,
      founding_year: null,
    },
    submission: {
      enriched_data: null,
    },
    brandImagesCount: 0,
    ...overrides,
  };
}

describe("phase satisfaction predicates", () => {
  it("links_satisfied_when_link_columns_resolved", () => {
    const data = makeData({
      brand: {
        purchase_website: "https://shop.example.com",
        website: null,
        description: null,
        founding_year: null,
      },
    });
    const result = checkPhaseSatisfaction("links", data);
    expect(result).toBe("satisfied");
  });

  it("links unsatisfied when no link columns populated", () => {
    const data = makeData();
    const result = checkPhaseSatisfaction("links", data);
    expect(result).toBe("unsatisfied");
  });

  it("products_satisfied_when_proposals_exist", () => {
    const data = makeData({
      submission: {
        enriched_data: {
          products: [
            {
              product_name: "Chair",
              official_url: "https://example.com/chair",
            },
          ],
        },
      },
    });
    const result = checkPhaseSatisfaction("products", data);
    expect(result).toBe("satisfied");
  });

  it("products unsatisfied when no proposals", () => {
    const data = makeData({
      submission: {
        enriched_data: { products: [] },
      },
    });
    const result = checkPhaseSatisfaction("products", data);
    expect(result).toBe("unsatisfied");
  });

  it("images_satisfied_when_brand_images_exist", () => {
    const data = makeData({ brandImagesCount: 5 });
    const result = checkPhaseSatisfaction("images", data);
    expect(result).toBe("satisfied");
  });

  it("images unsatisfied when no brand images", () => {
    const data = makeData({ brandImagesCount: 0 });
    const result = checkPhaseSatisfaction("images", data);
    expect(result).toBe("unsatisfied");
  });

  it("unsatisfiable_phases_report_unknown", () => {
    // Phases with no durable output (clean, site_identity, detect, etc.)
    // return 'unknown' — they cannot be skipped because there is no way to
    // know whether their work has been done.
    const data = makeData();
    const unknownPhases = [
      "clean",
      "site_identity",
      "detect",
      "slugs",
      "discover",
      "names",
    ] as const;
    for (const phase of unknownPhases) {
      const result = checkPhaseSatisfaction(phase, data);
      expect(
        result,
        `${phase} should return 'unknown', not '${result}'`,
      ).toBe("unknown");
    }
  });

  it("force_overrides_satisfaction", () => {
    // A phase that would be satisfied is reported as unsatisfied when force
    // is set, so the caller will re-run it.
    const data = makeData({
      brand: {
        purchase_website: "https://shop.example.com",
        website: null,
        description: null,
        founding_year: null,
      },
      brandImagesCount: 5,
      submission: {
        enriched_data: {
          products: [
            {
              product_name: "Chair",
              official_url: "https://example.com/chair",
            },
          ],
        },
      },
    });

    // Without force, these are satisfied
    expect(checkPhaseSatisfaction("links", data)).toBe("satisfied");
    expect(checkPhaseSatisfaction("images", data)).toBe("satisfied");
    expect(checkPhaseSatisfaction("products", data)).toBe("satisfied");

    // With force, they all become unsatisfied
    expect(checkPhaseSatisfaction("links", data, true)).toBe("unsatisfied");
    expect(checkPhaseSatisfaction("images", data, true)).toBe("unsatisfied");
    expect(checkPhaseSatisfaction("products", data, true)).toBe("unsatisfied");
  });

  it("descriptions satisfied when brand has description", () => {
    const data = makeData({
      brand: {
        purchase_website: null,
        website: null,
        description: "A Taiwanese furniture brand.",
        founding_year: null,
      },
    });
    expect(checkPhaseSatisfaction("descriptions", data)).toBe("satisfied");
  });

  it("reputation satisfied when enriched_data has reputationSummary", () => {
    const data = makeData({
      submission: {
        enriched_data: {
          reputationSummary: "Known for quality craftsmanship.",
        },
      },
    });
    expect(checkPhaseSatisfaction("reputation", data)).toBe("satisfied");
  });

  it("tags satisfied when enriched_data has category", () => {
    const data = makeData({
      submission: {
        enriched_data: {
          primaryCategorySlug: "furniture",
        },
      },
    });
    expect(checkPhaseSatisfaction("tags", data)).toBe("satisfied");
  });

  it("faq satisfied when enriched_data has faq", () => {
    const data = makeData({
      submission: {
        enriched_data: {
          faq: [{ question: "Q?", answer: "A." }],
        },
      },
    });
    expect(checkPhaseSatisfaction("faq", data)).toBe("satisfied");
  });

  it("classify_images returns unknown (no durable distinguishable output)", () => {
    const data = makeData({ brandImagesCount: 5 });
    expect(checkPhaseSatisfaction("classify_images", data)).toBe("unknown");
  });
});
