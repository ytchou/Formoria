import { describe, expect, it } from "vitest";
import {
  summarizeProductPreviews,
  type CuratedProduct,
} from "../curated-products";

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

function product(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    id: "product-id",
    brandId: BRAND_A,
    key: "pick",
    nameZh: "選品",
    nameEn: null,
    category: "home",
    subcategory: "tableware",
    officialUrl: "https://example.com/pick",
    imageUrl: null,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: "2026-08-13T00:00:00Z",
    reviewDueAt: null,
    productDescriptionZh: "一支手感穩定的產品。",
    productDescriptionEn: null,
    productPosition: null,
    createdAt: "2026-08-13T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: null,
    mitQualified: false,
    ...overrides,
  };
}

describe("summarizeProductPreviews", () => {
  it("counts every published row per brand", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      product({ id: `a-${index}`, key: `a-${index}` }),
    );

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)?.count).toBe(5);
  });

  it("takes the first three images in brand-page order", () => {
    // Brand-page order: productPosition (unplaced last), then createdAt, then key.
    // A row with no image still counts but contributes no thumbnail.
    const rows = [
      product({
        key: "unplaced",
        productPosition: null,
        imageUrl: "https://img/unplaced.jpg",
      }),
      product({
        key: "later-created",
        productPosition: 2,
        createdAt: "2026-08-14T00:00:00Z",
        imageUrl: "https://img/later-created.jpg",
      }),
      product({
        key: "b-key",
        productPosition: 2,
        createdAt: "2026-08-13T00:00:00Z",
        imageUrl: "https://img/b-key.jpg",
      }),
      product({
        key: "a-key",
        productPosition: 2,
        createdAt: "2026-08-13T00:00:00Z",
        imageUrl: null,
      }),
      product({
        key: "first",
        productPosition: 1,
        imageUrl: "https://img/first.jpg",
      }),
    ];

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)).toEqual({
      count: 5,
      thumbnails: [
        "https://img/first.jpg",
        "https://img/b-key.jpg",
        "https://img/later-created.jpg",
      ],
    });
  });

  it("drops rows with a null subcategory", () => {
    const rows = [
      product({ key: "kept", imageUrl: "https://img/kept.jpg" }),
      product({
        key: "dropped",
        subcategory: null,
        imageUrl: "https://img/dropped.jpg",
      }),
    ];

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)).toEqual({
      count: 1,
      thumbnails: ["https://img/kept.jpg"],
    });
  });

  it("returns no entry for a brand with zero rows", () => {
    const previews = summarizeProductPreviews([
      product({ brandId: BRAND_A }),
      product({ brandId: BRAND_B, subcategory: null }),
    ]);

    expect(previews.has(BRAND_A)).toBe(true);
    expect(previews.has(BRAND_B)).toBe(false);
    expect(summarizeProductPreviews([]).size).toBe(0);
  });
});
