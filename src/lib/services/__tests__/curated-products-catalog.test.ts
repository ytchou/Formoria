import { describe, expect, it } from "vitest";
import { transformCatalogRow } from "../curated-products-catalog";

describe("transformCatalogRow", () => {
  const baseRow = {
    id: "prod-1",
    key: "test-product",
    name_zh: "測試商品",
    name_en: "Test Product",
    category: "home",
    subcategories: ["candles", "diffusers"],
    image_url: "https://example.com/image.jpg",
    official_url: "https://example.com/product",
    brands: {
      slug: "test-brand",
      name: "Test Brand",
      status: "approved",
      purchase_website: "https://example.com",
      purchase_pinkoi: null,
      purchase_shopee: null,
      purchase_myship: null,
      social_instagram: "https://instagram.com/test",
      social_threads: null,
      social_facebook: null,
    },
  };

  it("maps snake_case row to camelCase CatalogProduct", () => {
    const result = transformCatalogRow(baseRow);
    expect(result).toEqual({
      id: "prod-1",
      key: "test-product",
      nameZh: "測試商品",
      nameEn: "Test Product",
      category: "home",
      subcategories: ["candles", "diffusers"],
      imageUrl: "https://example.com/image.jpg",
      officialUrl: "https://example.com/product",
      brandSlug: "test-brand",
      brandName: "Test Brand",
      brand: {
        slug: "test-brand",
        purchaseWebsite: "https://example.com",
        purchasePinkoi: null,
        purchaseShopee: null,
        purchaseMyship: null,
        socialInstagram: "https://instagram.com/test",
        socialThreads: null,
        socialFacebook: null,
      },
    });
  });

  it("handles null optional fields", () => {
    const row = {
      ...baseRow,
      name_en: null,
      subcategories: null,
      brands: {
        ...baseRow.brands,
        purchase_website: null,
      },
    };
    const result = transformCatalogRow(row);
    expect(result.nameEn).toBeNull();
    expect(result.subcategories).toEqual([]);
    expect(result.brand.purchaseWebsite).toBeNull();
  });

  it("throws when brand join is missing", () => {
    const row = { ...baseRow, brands: null };
    expect(() => transformCatalogRow(row as never)).toThrow(
      "Catalog product prod-1 is missing its brand",
    );
  });
});
