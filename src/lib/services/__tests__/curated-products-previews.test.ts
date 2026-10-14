import { describe, expect, it } from "vitest";
import {
  curatedImageIdentity,
  dropSharedImageProducts,
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
      product({
        id: `a-${index}`,
        key: `a-${index}`,
        imageUrl: `/i/curated-products/a-${index}.webp`,
      }),
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

describe("curatedImageIdentity", () => {
  it("is the last path segment with the query string and fragment stripped", () => {
    expect(curatedImageIdentity("/i/curated-products/brand/d89b3656.webp")).toBe(
      "d89b3656.webp",
    );
    expect(
      curatedImageIdentity("https://cdn.example.com/x/d89b3656.webp?w=640#top"),
    ).toBe("d89b3656.webp");
  });

  it("falls back to the full URL when there is no last segment", () => {
    expect(curatedImageIdentity("https://cdn.example.com/x/")).toBe(
      "https://cdn.example.com/x/",
    );
  });
});

describe("dropSharedImageProducts (BD-04)", () => {
  it("keeps only the first product in brand-page order when two share a photo", () => {
    const { kept, dropped } = dropSharedImageProducts([
      product({ key: "pen-box", imageUrl: "/i/curated-products/d89b3656.webp" }),
      product({ key: "chopsticks", imageUrl: "/i/curated-products/d89b3656.webp" }),
      product({ key: "pen-box-2", imageUrl: "/i/other-dir/d89b3656.webp" }),
    ]);

    expect(kept.map((row) => row.key)).toEqual(["pen-box"]);
    expect(dropped).toEqual([
      {
        brandId: BRAND_A,
        key: "chopsticks",
        keptKey: "pen-box",
        imageIdentity: "d89b3656.webp",
      },
      {
        brandId: BRAND_A,
        key: "pen-box-2",
        keptKey: "pen-box",
        imageIdentity: "d89b3656.webp",
      },
    ]);
  });

  it("treats the same filename with a different query string as the same photo", () => {
    const { kept } = dropSharedImageProducts([
      product({ key: "first", imageUrl: "/i/curated-products/hash.webp?v=1" }),
      product({ key: "second", imageUrl: "/i/curated-products/hash.webp?v=2" }),
    ]);

    expect(kept.map((row) => row.key)).toEqual(["first"]);
  });

  it("leaves products with distinct photos untouched", () => {
    const rows = [
      product({ key: "a", imageUrl: "/i/curated-products/a.webp" }),
      product({ key: "b", imageUrl: "/i/curated-products/b.webp" }),
    ];

    const { kept, dropped } = dropSharedImageProducts(rows);

    expect(kept).toEqual(rows);
    expect(dropped).toEqual([]);
  });

  it("never dedupes across brands", () => {
    const { kept } = dropSharedImageProducts([
      product({ brandId: BRAND_A, key: "a", imageUrl: "/i/shared.webp" }),
      product({ brandId: BRAND_B, key: "b", imageUrl: "/i/shared.webp" }),
    ]);

    expect(kept.map((row) => row.key)).toEqual(["a", "b"]);
  });

  it("drops the later-placed duplicate from the directory preview count", () => {
    // Input order is not brand-page order: the placed product keeps the photo.
    const previews = summarizeProductPreviews([
      product({ key: "unplaced", productPosition: null, imageUrl: "/i/same.webp" }),
      product({ key: "placed", productPosition: 1, imageUrl: "/i/same.webp" }),
      product({ key: "other", productPosition: 2, imageUrl: "/i/other.webp" }),
    ]);

    expect(previews.get(BRAND_A)).toEqual({
      count: 2,
      thumbnails: ["/i/same.webp", "/i/other.webp"],
    });
  });
});
