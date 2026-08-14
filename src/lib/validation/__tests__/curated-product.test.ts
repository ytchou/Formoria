import { describe, expect, it } from "vitest";

import {
  CURATED_PRODUCT_L1_VALUES,
  MAX_CURATED_PRODUCT_NAME,
  curatedProductCreateSchema,
  curatedProductIdSchema,
  curatedProductSourceSchema,
  curatedProductUpdateSchema,
  prefillUrlSchema,
} from "@/lib/validation/curated-product";

const BRAND_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function validCreate(overrides: Record<string, unknown> = {}) {
  return {
    brandId: BRAND_ID,
    nameZh: "手沖濾杯",
    l1: "home",
    ...overrides,
  };
}

describe("curated product validation", () => {
  it("rejects_non_uuid_product_id", () => {
    expect(curatedProductIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(curatedProductIdSchema.safeParse(BRAND_ID).success).toBe(true);
  });

  it("rejects_l1_outside_the_twelve", () => {
    // The CHECK constraint in 20260813120000_curated_products.sql would reject
    // this too, but only after a round trip that surfaces as a 500.
    expect(CURATED_PRODUCT_L1_VALUES).toHaveLength(12);
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ l1: "furniture" }))
        .success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ l1: "home" })).success,
    ).toBe(true);
  });

  it("rejects_overlong_name", () => {
    const tooLong = "字".repeat(MAX_CURATED_PRODUCT_NAME + 1);
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ nameZh: tooLong }))
        .success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ nameZh: "字".repeat(MAX_CURATED_PRODUCT_NAME) }),
      ).success,
    ).toBe(true);
  });

  it("accepts_missing_optional_fields", () => {
    const result = curatedProductCreateSchema.safeParse(validCreate());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nameEn).toBeUndefined();
    expect(result.data.notesZh).toBeUndefined();
    expect(result.data.notesEn).toBeUndefined();
    expect(result.data.reviewDueAt).toBeUndefined();
    // An empty patch is legal: the update writer no-ops on it rather than
    // rewriting untouched columns.
    expect(curatedProductUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects_non_https_official_url", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "ftp://example.com/product",
      "example.com/product",
    ]) {
      expect(
        curatedProductCreateSchema.safeParse(validCreate({ officialUrl: url }))
          .success,
      ).toBe(false);
    }
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ officialUrl: "https://example.com/product" }),
      ).success,
    ).toBe(true);
  });

  it("holds the same URL bar on sources and on the prefill action", () => {
    expect(
      curatedProductSourceSchema.safeParse({
        url: "javascript:alert(1)",
        sourceType: "official",
      }).success,
    ).toBe(false);
    expect(
      curatedProductSourceSchema.safeParse({
        url: "https://example.com/press",
        sourceType: "press",
        claimZh: "官方公布的材質說明",
      }).success,
    ).toBe(true);
    expect(
      curatedProductSourceSchema.safeParse({
        url: "https://example.com/press",
        sourceType: "blog",
      }).success,
    ).toBe(false);
    expect(prefillUrlSchema.safeParse("javascript:alert(1)").success).toBe(
      false,
    );
    expect(prefillUrlSchema.safeParse("https://example.com/p").success).toBe(
      true,
    );
  });
});
