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
    // The common case: a published product carries a mirrored image.
    imageUrl: "/i/curated-products/pick.webp",
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
    // A row with no image is dropped, exactly as the brand page drops it
    // (DEV-1962), so it neither counts nor takes a thumbnail slot.
    const rows = [
      product({
        key: "unplaced",
        productPosition: null,
        imageUrl: "/i/unplaced.jpg",
      }),
      product({
        key: "later-created",
        productPosition: 2,
        createdAt: "2026-08-14T00:00:00Z",
        imageUrl: "/i/later-created.jpg",
      }),
      product({
        key: "b-key",
        productPosition: 2,
        createdAt: "2026-08-13T00:00:00Z",
        imageUrl: "/i/b-key.jpg",
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
        imageUrl: "/i/first.jpg",
      }),
    ];

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)).toEqual({
      count: 4,
      thumbnails: [
        "/i/first.jpg",
        "/i/b-key.jpg",
        "/i/later-created.jpg",
      ],
    });
  });

  it("fills thumbnail slots only with URLs safeImageSrc accepts", () => {
    // `//host/…` is protocol-relative (offsite) and always rejected; `/i/…` is
    // the same-origin image proxy and always accepted, whatever the env. A row
    // whose image the tile cannot render is not counted either: the brand page
    // drops it (DEV-1962).
    const rows = [
      product({ key: "a", productPosition: 1, imageUrl: "//evil.example/a.jpg" }),
      product({ key: "b", productPosition: 2, imageUrl: "//evil.example/b.jpg" }),
      product({ key: "c", productPosition: 3, imageUrl: "/i/c.jpg" }),
      product({ key: "d", productPosition: 4, imageUrl: "/i/d.jpg" }),
      product({ key: "e", productPosition: 5, imageUrl: "/i/e.jpg" }),
    ];

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)).toEqual({
      count: 3,
      thumbnails: ["/i/c.jpg", "/i/d.jpg", "/i/e.jpg"],
    });
  });

  it("drops rows with a null subcategory", () => {
    const rows = [
      product({ key: "kept", imageUrl: "/i/kept.jpg" }),
      product({
        key: "dropped",
        subcategory: null,
        imageUrl: "/i/dropped.jpg",
      }),
    ];

    const previews = summarizeProductPreviews(rows);

    expect(previews.get(BRAND_A)).toEqual({
      count: 1,
      thumbnails: ["/i/kept.jpg"],
    });
  });

  it("returns no entry for a brand whose only rows have no photo", () => {
    const previews = summarizeProductPreviews([
      product({ brandId: BRAND_A }),
      product({ brandId: BRAND_B, imageUrl: null }),
    ]);

    expect(previews.get(BRAND_A)?.count).toBe(1);
    expect(previews.has(BRAND_B)).toBe(false);
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
