import { describe, expect, it } from "vitest";

import {
  CURATED_PRODUCT_CATEGORY_VALUES,
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
    category: "home",
    productDescriptionZh: "錐形濾杯，單孔設計。",
    ...overrides,
  };
}

describe("curated product validation", () => {
  it("rejects_non_uuid_product_id", () => {
    expect(curatedProductIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(curatedProductIdSchema.safeParse(BRAND_ID).success).toBe(true);
  });

  it("rejects_category_outside_the_twelve", () => {
    // The CHECK constraint in 20260813120000_curated_products.sql would reject
    // this too, but only after a round trip that surfaces as a 500.
    // Thirteen after DEV-1510 split `kids-pets`, twelve after DEV-1507 retired
    // `crafts`; the list itself is derived from `L1_CATEGORIES`, so only this
    // pin moved.
    expect(CURATED_PRODUCT_CATEGORY_VALUES).toHaveLength(12);
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ category: "furniture" }),
      ).success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ category: "home" }))
        .success,
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
    expect(result.data.productDescriptionEn).toBeUndefined();
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

  it("accepts null on every clearable editorial field", () => {
    // Null is the only way to EMPTY a field the editor filled in by mistake:
    // an absent key means "untouched", so without the nullable half there is no
    // payload that can clear one.
    const cleared = curatedProductUpdateSchema.safeParse({
      nameEn: null,
      officialUrl: null,
      imageSourceUrl: null,
      productDescriptionEn: null,
      reviewDueAt: null,
    });
    expect(cleared.success).toBe(true);
    if (!cleared.success) return;
    expect(cleared.data.officialUrl).toBeNull();
    expect(cleared.data.reviewDueAt).toBeNull();
    // Still validated when a value IS supplied.
    expect(
      curatedProductUpdateSchema.safeParse({
        officialUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("rejects a create with no zh description", () => {
    for (const value of [undefined, "", "  \t"]) {
      const payload = validCreate();
      if (value === undefined)
        delete (payload as Record<string, unknown>).productDescriptionZh;
      else (payload as Record<string, unknown>).productDescriptionZh = value;

      const result = curatedProductCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["productDescriptionZh"] }),
      );
    }
  });

  it("accepts a create with a zh description and no en twin", () => {
    const result = curatedProductCreateSchema.safeParse(validCreate());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.productDescriptionZh).toBe("錐形濾杯，單孔設計。");
    expect(result.data.productDescriptionEn).toBeUndefined();
  });

  it("accepts a product_position with no extra requirement", () => {
    // The cross-field refine is GONE (DEV-1496): a position is an ordering
    // fact, and the description it used to demand is now mandatory anyway.
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ productPosition: 1 }))
        .success,
    ).toBe(true);
    expect(
      curatedProductUpdateSchema.safeParse({ productPosition: 1 }).success,
    ).toBe(true);
  });

  it("rejects removed keys", () => {
    // `wallPosition` and `imageUsage` are GONE (DEV-1485): the wall is a pure
    // shuffle, so there is no hand-placed slot, and image rights are no longer
    // a payload field. zod strips unknown keys rather than erroring, so the
    // assertion that matters is that neither survives into `.data` — a schema
    // that silently carried them would let a stale form write dropped columns.
    const created = curatedProductCreateSchema.safeParse(
      validCreate({ wallPosition: 3, imageUsage: "permitted" }),
    );
    const updated = curatedProductUpdateSchema.safeParse({
      wallPosition: 3,
      imageUsage: "permitted",
    });

    expect(created.success).toBe(true);
    expect(updated.success).toBe(true);
    if (!created.success || !updated.success) return;
    expect(created.data).not.toHaveProperty("wallPosition");
    expect(created.data).not.toHaveProperty("imageUsage");
    expect(updated.data).not.toHaveProperty("wallPosition");
    expect(updated.data).not.toHaveProperty("imageUsage");
  });

  it("accepts visible on create and update", () => {
    // The boolean that replaced `lifecycle`: a product is either on the site or
    // it is not, with no state machine in between.
    const created = curatedProductCreateSchema.safeParse(
      validCreate({ visible: false }),
    );

    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.data.visible).toBe(false);
    expect(
      curatedProductUpdateSchema.safeParse({ visible: true }).success,
    ).toBe(true);
    // Absent is legal — the column carries its own NOT NULL DEFAULT true.
    expect(curatedProductCreateSchema.safeParse(validCreate()).success).toBe(
      true,
    );
  });

  it("requires a known category-compatible L2 before creating a visible product", () => {
    // Catches publication through the input boundary with a missing, unknown, or cross-L1 L2.
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ visible: true }))
        .success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ visible: true, subcategory: "not-in-ontology" }),
      ).success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ visible: true, subcategory: "handbags" }),
      ).success,
    ).toBe(false);
    expect(
      curatedProductCreateSchema.safeParse(
        validCreate({ visible: true, subcategory: "tableware" }),
      ).success,
    ).toBe(true);
  });

  it("still accepts a non-negative productPosition and rejects a negative one", () => {
    // `productPosition` is the ordering fact that SURVIVES the DEV-1485 cut;
    // 0 is the boundary the other position tests do not exercise.
    expect(
      curatedProductCreateSchema.safeParse(validCreate({ productPosition: 0 }))
        .success,
    ).toBe(true);
    expect(
      curatedProductUpdateSchema.safeParse({ productPosition: 0 }).success,
    ).toBe(true);
    expect(
      curatedProductUpdateSchema.safeParse({ productPosition: -1 }).success,
    ).toBe(false);
  });

  it("rejects a negative product_position", () => {
    const result = curatedProductUpdateSchema.safeParse({
      productPosition: -1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: ["productPosition"] }),
    );
  });

  it("refuses a subcategory patch that does not name its category", () => {
    // Refused at the BOUNDARY so the action returns its generic
    // "Invalid curated product"; the service keeps the same rule as a throwing
    // backstop, whose raw message would otherwise reach the editor.
    expect(
      curatedProductUpdateSchema.safeParse({ subcategory: "tableware" })
        .success,
    ).toBe(false);
    expect(
      curatedProductUpdateSchema.safeParse({
        category: "home",
        subcategory: "tableware",
      }).success,
    ).toBe(true);
  });
});
