import { describe, expect, it } from "vitest";
import type { Brand } from "@/lib/types";
import {
  getBrandCategoryLabel,
  getCategoryLabel,
  resolveCategorySlug,
} from "../category-label";

describe("getCategoryLabel", () => {
  it("returns zh-TW label for known slug", () => {
    expect(getCategoryLabel("fashion")).toBe("服飾鞋履");
    expect(getCategoryLabel("food-drink")).toBe("食品飲料");
  });

  it("returns EN label when locale is en", () => {
    expect(getCategoryLabel("fashion", "en")).toBe("Fashion & Apparel");
  });

  it("resolves localized display values to the canonical slug", () => {
    expect(resolveCategorySlug("居家生活")).toBe("home");
    expect(resolveCategorySlug("Home & Living")).toBe("home");
  });
});

describe("getBrandCategoryLabel", () => {
  it("translates a Chinese domain category for English pages", () => {
    expect(getBrandCategoryLabel({ categorySlug: "fashion" } as Brand, "en")).toBe(
      "Fashion & Apparel",
    );
  });

  it("returns label for visible category", () => {
    expect(getBrandCategoryLabel({ categorySlug: "home" })).toBe("居家生活");
  });

  it("returns empty string for deferred category", () => {
    expect(getBrandCategoryLabel({ categorySlug: "pets" })).toBe("");
  });
});
