import { describe, expect, it } from "vitest";
import { countSplits, splitRoster } from "./split";
import { EVAL_CATEGORY_SLUGS, type GoldenRosterBrand } from "./types";

function brands(): Omit<GoldenRosterBrand, "split">[] {
  return EVAL_CATEGORY_SLUGS.flatMap((productType) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${productType}-${index}`,
      slug: `${productType}-${index}`,
      name: `${productType} brand ${index}`,
      productType,
      purchaseWebsite: `https://${productType}-${index}.example`,
    })),
  );
}

describe("golden brand split", () => {
  it("creates a deterministic 35/15 split with every category in both partitions", () => {
    const first = splitRoster(brands());
    const second = splitRoster(brands().toReversed());
    expect(first).toEqual(second);
    expect(countSplits(first)).toEqual({ dev: 35, holdout: 15 });

    for (const category of EVAL_CATEGORY_SLUGS) {
      const categoryBrands = first.filter(
        (brand) => brand.productType === category,
      );
      expect(categoryBrands.some((brand) => brand.split === "dev")).toBe(true);
      expect(categoryBrands.some((brand) => brand.split === "holdout")).toBe(
        true,
      );
    }
  });

  it("rejects a roster that could silently weaken the holdout size", () => {
    expect(() => splitRoster(brands().slice(0, 49))).toThrow(
      "Expected 50 brands",
    );
  });
});
