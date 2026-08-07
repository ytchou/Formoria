import { describe, expect, it } from "vitest";
import type { Brand } from "@/lib/types";
import {
  getBrandCategoryLabel,
  getProductTypeLabel,
  resolveProductTypeSlug,
} from "../category-label";

describe("getProductTypeLabel", () => {
  it("returns zh-TW label for known slug", () => {
    expect(getProductTypeLabel("fashion")).toBe("服飾鞋履");
    expect(getProductTypeLabel("food-drink")).toBe("食品飲料");
  });

  it("returns EN label when locale is en", () => {
    expect(getProductTypeLabel("fashion", "en")).toBe("Fashion & Apparel");
  });

  it("resolves localized display values to the canonical slug", () => {
    expect(resolveProductTypeSlug("工藝文創")).toBe("crafts");
    expect(resolveProductTypeSlug("Crafts & Art")).toBe("crafts");
  });
});

describe("getBrandCategoryLabel", () => {
  it("translates a Chinese domain category for English pages", () => {
    expect(getBrandCategoryLabel({ category: "服飾鞋履" } as Brand, "en")).toBe(
      "Fashion & Apparel",
    );
  });
});
