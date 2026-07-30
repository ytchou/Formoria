import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICE_RANGE,
  formatPriceRange,
  resolveEnrichedPriceRange,
} from "../price-range";

describe("formatPriceRange", () => {
  it("returns the prefix for a known tier", () => {
    expect(formatPriceRange(1)).toBe("$");
    expect(formatPriceRange(2)).toBe("$$");
    expect(formatPriceRange(3)).toBe("$$$");
  });

  it("returns null for anything outside the tiers", () => {
    expect(formatPriceRange(null)).toBeNull();
    expect(formatPriceRange(0)).toBeNull();
    expect(formatPriceRange("2")).toBeNull();
  });
});

describe("resolveEnrichedPriceRange", () => {
  it("keeps a tier the model actually determined", () => {
    expect(resolveEnrichedPriceRange(1)).toBe(1);
    expect(resolveEnrichedPriceRange(2)).toBe(2);
    expect(resolveEnrichedPriceRange(3)).toBe(3);
  });

  it("falls back to mid-range when the model found no price signal", () => {
    expect(resolveEnrichedPriceRange(null)).toBe(DEFAULT_PRICE_RANGE);
    expect(resolveEnrichedPriceRange(undefined)).toBe(DEFAULT_PRICE_RANGE);
  });

  it("absorbs out-of-range model output instead of writing it through", () => {
    expect(resolveEnrichedPriceRange(0)).toBe(DEFAULT_PRICE_RANGE);
    expect(resolveEnrichedPriceRange(4)).toBe(DEFAULT_PRICE_RANGE);
    expect(resolveEnrichedPriceRange(2.5)).toBe(DEFAULT_PRICE_RANGE);
    expect(resolveEnrichedPriceRange("2")).toBe(DEFAULT_PRICE_RANGE);
  });

  it("resolves to a tier the completeness gate accepts", () => {
    expect([1, 2, 3]).toContain(resolveEnrichedPriceRange(null));
  });
});
