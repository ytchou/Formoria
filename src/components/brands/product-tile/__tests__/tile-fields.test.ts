import { describe, expect, it } from "vitest";

import { tileFields, type SelectedProductTileProduct } from "../tile-fields";

const labels = { cta: "Visit product", brandSiteCta: "Visit brand site" };

const brand = {
  purchaseWebsite: "https://brand.example",
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
};

function product(
  overrides: Partial<SelectedProductTileProduct> = {},
): SelectedProductTileProduct {
  return {
    id: "product-1",
    key: "kettle",
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    productDescriptionZh: "手感穩定",
    productDescriptionEn: "Steady in the hand",
    imageUrl: "/i/curated-products/p/kettle.jpg",
    subcategory: null,
    category: "home",
    linkState: "ok",
    officialUrl: "https://example.com/kettle",
    mitQualified: false,
    ...overrides,
  };
}

describe("tileFields", () => {
  it("reads the locale's name and description with no lang mark", () => {
    const en = tileFields(product(), "en", labels);
    expect(en.name).toBe("Pour-over kettle");
    expect(en.description).toBe("Steady in the hand");
    expect(en.nameLang).toBeUndefined();
    expect(en.descriptionLang).toBeUndefined();

    const zh = tileFields(product(), "zh-TW", labels);
    expect(zh.name).toBe("手沖壺");
    expect(zh.description).toBe("手感穩定");
    expect(zh.nameLang).toBeUndefined();
  });

  it("falls back to zh on an EN page and marks it zh-Hant-TW", () => {
    const fields = tileFields(
      product({ nameEn: null, productDescriptionEn: null }),
      "en",
      labels,
    );
    expect(fields.name).toBe("手沖壺");
    expect(fields.nameLang).toBe("zh-Hant-TW");
    expect(fields.description).toBe("手感穩定");
    expect(fields.descriptionLang).toBe("zh-Hant-TW");
  });

  it("links out to the product page when the link is healthy", () => {
    const fields = tileFields(product(), "en", labels, brand);
    expect(fields.isBroken).toBe(false);
    expect(fields.chip).toEqual({
      href: "https://example.com/kettle",
      label: "Visit product",
      linkType: "curated_product",
    });
  });

  it("falls back to the brand site when the product link is broken", () => {
    const fields = tileFields(
      product({ linkState: "broken" }),
      "en",
      labels,
      brand,
    );
    expect(fields.isBroken).toBe(true);
    expect(fields.chip).toEqual({
      href: "https://brand.example",
      label: "Visit brand site",
      linkType: "brand_site",
    });
  });

  it("has no outbound href for a broken link without a brand", () => {
    const fields = tileFields(product({ linkState: "broken" }), "en", labels);
    expect(fields.chip.href).toBeNull();
  });

  it("rejects an unsafe image source and resolves no subcategory when absent", () => {
    const fields = tileFields(
      product({ imageUrl: "javascript:alert(1)" }),
      "en",
      labels,
    );
    expect(fields.imageSrc).toBeNull();
    expect(fields.subcategoryName).toBeNull();
  });
});
