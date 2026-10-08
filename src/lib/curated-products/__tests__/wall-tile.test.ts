import { describe, expect, it } from "vitest";

import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import { toWallTileProduct } from "../wall-tile";

// Every field populated, so a field the projection forgot to drop shows up as a
// non-null value in the strict comparison below.
const FULL: HomepageCuratedProduct = {
  id: "product-1",
  brandId: "brand-id-1",
  key: "hand-drip-kettle",
  nameZh: "手沖壺",
  nameEn: "Hand-drip kettle",
  category: "home",
  subcategory: "tableware",
  officialUrl: "https://example.com/kettle",
  imageUrl: "https://images.example.com/kettle.webp",
  imageSourceUrl: "https://source.example.com/kettle.jpg",
  visible: true,
  linkState: "ok",
  linkCheckedAt: "2026-09-01T00:00:00Z",
  sourceCheckedAt: "2026-09-02T00:00:00Z",
  reviewDueAt: "2026-12-01T00:00:00Z",
  productDescriptionZh: "手感穩定，適合小空間。",
  productDescriptionEn: "Steady in the hand.",
  productPosition: 3,
  createdAt: "2026-08-15T00:00:00Z",
  trailSlug: "desk",
  sectionKey: "section-1",
  position: 2,
  mitQualified: true,
  imageWidth: 1200,
  imageHeight: 900,
  brandSlug: "little-tool",
  brandName: "小器生活",
  brand: {
    slug: "little-tool",
    purchaseWebsite: "https://example.com",
    purchasePinkoi: "https://pinkoi.com/store/x",
    purchaseShopee: "https://shopee.tw/x",
    purchaseMyship: "https://myship.7-11.com.tw/x",
    socialInstagram: "https://instagram.com/x",
    socialThreads: "https://threads.net/@x",
    socialFacebook: "https://facebook.com/x",
  },
};

describe("toWallTileProduct", () => {
  it("copies exactly the fields the wall tile reads, plus the brand fields", () => {
    expect(toWallTileProduct(FULL)).toStrictEqual({
      id: "product-1",
      key: "hand-drip-kettle",
      nameZh: "手沖壺",
      nameEn: "Hand-drip kettle",
      productDescriptionZh: "手感穩定，適合小空間。",
      productDescriptionEn: "Steady in the hand.",
      imageUrl: "https://images.example.com/kettle.webp",
      subcategory: "tableware",
      category: "home",
      linkState: "ok",
      officialUrl: "https://example.com/kettle",
      mitQualified: true,
      brandSlug: "little-tool",
      brandName: "小器生活",
      brand: {
        slug: "little-tool",
        purchaseWebsite: "https://example.com",
        purchasePinkoi: "https://pinkoi.com/store/x",
        purchaseShopee: "https://shopee.tw/x",
        purchaseMyship: "https://myship.7-11.com.tw/x",
        socialInstagram: "https://instagram.com/x",
        socialThreads: "https://threads.net/@x",
        socialFacebook: "https://facebook.com/x",
      },
    });
  });

  it("leaves the heavy and audit fields out of the client payload", () => {
    const projected = toWallTileProduct(FULL) as Record<string, unknown>;

    for (const field of [
      "brandId",
      "imageSourceUrl",
      "visible",
      "linkCheckedAt",
      "sourceCheckedAt",
      "reviewDueAt",
      "productPosition",
      "createdAt",
      "trailSlug",
      "sectionKey",
      "position",
      "imageWidth",
      "imageHeight",
    ]) {
      expect(projected).not.toHaveProperty(field);
    }
  });
});
