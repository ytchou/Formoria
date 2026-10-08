import { describe, expect, it } from "vitest";

import {
  summarizeCategoryPositionRows,
  type CategoryPositionRow,
} from "../delete-category-position-faq";

function row(overrides: Partial<CategoryPositionRow> = {}): CategoryPositionRow {
  return {
    brandId: "brand-a",
    brandSlug: "brand-a",
    position: 0,
    questionZh: "文具設計類別包含哪些品牌？",
    source: "model",
    brandCity: "taipei",
    modelFaqCount: 5,
    seoPromoted: true,
    ...overrides,
  };
}

describe("summarizeCategoryPositionRows", () => {
  it("deletes model rows only and reports human rows as skipped", () => {
    const report = summarizeCategoryPositionRows([
      row(),
      row({ brandId: "brand-b", brandSlug: "brand-b", source: "human" }),
      row({ brandId: "brand-c", brandSlug: "brand-c" }),
    ]);

    expect(report.total).toBe(3);
    expect(report.bySource).toEqual([
      ["human", 1],
      ["model", 2],
    ]);
    expect(report.deletable.map((entry) => entry.brandSlug)).toEqual([
      "brand-a",
      "brand-c",
    ]);
    expect(report.skippedHuman.map((entry) => entry.brandSlug)).toEqual([
      "brand-b",
    ]);
  });

  // `seo_promoted` accepts `model_faq_count >= 3` in place of a city, and the
  // delete trigger decrements that count.
  it("lists promoted brands without a city that fall below the FAQ floor", () => {
    const report = summarizeCategoryPositionRows([
      row({ brandId: "at-floor", brandSlug: "at-floor", brandCity: null, modelFaqCount: 3 }),
      row({ brandId: "above", brandSlug: "above", brandCity: null, modelFaqCount: 4 }),
      row({ brandId: "has-city", brandSlug: "has-city", modelFaqCount: 3 }),
      row({
        brandId: "unpromoted",
        brandSlug: "unpromoted",
        brandCity: " ",
        modelFaqCount: 3,
        seoPromoted: false,
      }),
      row({
        brandId: "human-only",
        brandSlug: "human-only",
        brandCity: null,
        modelFaqCount: 3,
        source: "human",
      }),
    ]);

    expect(report.losesSeoPromotion).toEqual(["at-floor"]);
  });

  it("reports nothing for an empty table", () => {
    expect(summarizeCategoryPositionRows([])).toEqual({
      total: 0,
      bySource: [],
      deletable: [],
      skippedHuman: [],
      losesSeoPromotion: [],
    });
  });
});
