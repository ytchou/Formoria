import { describe, expect, it } from "vitest";

import {
  dedupeByBrandPerSection,
  isTrailEligibleProduct,
  toPicksJson,
  type ShortlistCandidate,
  type TrailEligibilityRow,
} from "./lib";

function candidate(
  overrides: Partial<ShortlistCandidate> & {
    sectionKey: string;
    brandSlug: string;
    productKey: string;
    rank: number;
  },
): ShortlistCandidate {
  return {
    productId: `id-${overrides.brandSlug}-${overrides.productKey}`,
    name: `name ${overrides.productKey}`,
    brandName: `brand ${overrides.brandSlug}`,
    subcategory: "lamps",
    imageUrl: null,
    officialUrl: "https://example.com/p",
    ...overrides,
  };
}

describe("dedupeByBrandPerSection", () => {
  it("keeps the highest-scored product per brand within a section", () => {
    const result = dedupeByBrandPerSection([
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "b", rank: 3 }),
      candidate({ sectionKey: "light", brandSlug: "niizo", productKey: "c", rank: 2 }),
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "a", rank: 1 }),
    ]);

    expect(result.map((row) => [row.brandSlug, row.productKey])).toEqual([
      ["kiln", "a"],
      ["niizo", "c"],
    ]);
  });

  it("allows the same brand across sections", () => {
    const result = dedupeByBrandPerSection([
      candidate({ sectionKey: "light", brandSlug: "kiln", productKey: "a", rank: 1 }),
      candidate({ sectionKey: "cloth", brandSlug: "kiln", productKey: "b", rank: 1 }),
    ]);

    expect(result.map((row) => [row.sectionKey, row.productKey])).toEqual([
      ["light", "a"],
      ["cloth", "b"],
    ]);
  });
});

describe("toPicksJson", () => {
  it("emits { trail, sections: { key: [{ brandSlug, productKey, note }] } } from checked rows", () => {
    const picks = toPicksJson("quiet-evening", [
      { sectionKey: "light", brandSlug: "kiln", productKey: "a", note: " 暖光 ", checked: true },
      { sectionKey: "light", brandSlug: "niizo", productKey: "c", note: "", checked: false },
      { sectionKey: "cloth", brandSlug: "kiln", productKey: "b", note: "厚棉", checked: true },
      { sectionKey: "light", brandSlug: "lumen", productKey: "d", note: "可調", checked: true },
    ]);

    expect(picks).toEqual({
      trail: "quiet-evening",
      sections: {
        light: [
          { brandSlug: "kiln", productKey: "a", note: "暖光" },
          { brandSlug: "lumen", productKey: "d", note: "可調" },
        ],
        cloth: [{ brandSlug: "kiln", productKey: "b", note: "厚棉" }],
      },
    });
  });
});

describe("isTrailEligibleProduct", () => {
  const eligible: TrailEligibilityRow = {
    visible: true,
    official_url: "https://example.com/p",
    source_checked_at: "2026-09-01T00:00:00Z",
    subcategory: "lamps",
    brands: { status: "approved" },
    curated_product_sources: [{ state: "retired" }, { state: "active" }],
  };

  it("accepts an eligible product with no placement requirement", () => {
    expect(isTrailEligibleProduct(eligible)).toBe(true);
  });

  it.each([
    ["hidden", { visible: false }],
    ["no official url", { official_url: null }],
    ["never source-checked", { source_checked_at: null }],
    ["no subcategory", { subcategory: null }],
    ["unapproved brand", { brands: { status: "pending" } }],
    ["no active source", { curated_product_sources: [{ state: "retired" }] }],
    ["no source rows", { curated_product_sources: [] }],
  ] as const)("rejects a product with %s", (_label, overrides) => {
    expect(isTrailEligibleProduct({ ...eligible, ...overrides })).toBe(false);
  });
});
