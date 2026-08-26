import { describe, it, expect } from "vitest";
import {
  brandToDomain,
  brandToInsert,
  extractLatinRun,
  generateSlug,
} from "../brands";

// Minimal row shape matching Supabase SELECT output
function makeBrandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "brand-1",
    name: "Test Brand",
    slug: "test-brand",
    description: "A test brand",
    hero_image_url: null,
    status: "approved" as const,
    category: "fashion",
    website_url: null,
    contact_email: null,
    founding_year: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    product_highlights: [],
    submitted_at: "2026-01-01T00:00:00Z",
    approved_at: "2026-01-02T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mixed-script brand slugs", () => {
  it.each([
    ["郁郁 YùYù", "yuyu"],
    ["雱PĀNG", "pang"],
    ["Chi-Bee", "chi-bee"],
  ])("preserves the full public name for %s", (name, expected) => {
    const source = extractLatinRun(name) ?? name;

    expect(generateSlug(source)).toBe(expected);
  });
});

describe("brandToDomain — romanized name", () => {
  it("maps romanized_name to public-display metadata", () => {
    const brand = brandToDomain(
      makeBrandRow({ romanized_name: "Warmwood Living" }),
    );
    expect(brand.romanizedName).toBe("Warmwood Living");
  });
});

describe("brandToDomain — isDemo", () => {
  it("maps is_demo true to isDemo true", () => {
    const row = makeBrandRow({ is_demo: true });
    const brand = brandToDomain(row);
    expect(brand.isDemo).toBe(true);
  });

  it("maps is_demo false to isDemo false", () => {
    const row = makeBrandRow({ is_demo: false });
    const brand = brandToDomain(row);
    expect(brand.isDemo).toBe(false);
  });

  it("defaults isDemo to false when is_demo is missing", () => {
    const row = makeBrandRow();
    // makeBrandRow does not include is_demo
    const brand = brandToDomain(row);
    expect(brand.isDemo).toBe(false);
  });
});

describe("brandToDomain (flat link columns)", () => {
  it("maps social flat columns to domain fields", () => {
    const row = makeBrandRow({
      social_instagram: "test_brand",
      social_threads: "@testbrand",
      social_facebook: "https://facebook.com/testbrand",
    });
    const brand = brandToDomain(row);
    expect(brand.socialInstagram).toBe("test_brand");
    expect(brand.socialThreads).toBe("@testbrand");
    expect(brand.socialFacebook).toBe("https://facebook.com/testbrand");
  });

  it("maps purchase flat columns to domain fields", () => {
    const row = makeBrandRow({
      purchase_website: "https://testbrand.com",
      purchase_pinkoi: "https://pinkoi.com/store/testbrand",
      purchase_shopee: "https://shopee.tw/testbrand",
    });
    const brand = brandToDomain(row);
    expect(brand.purchaseWebsite).toBe("https://testbrand.com");
    expect(brand.purchasePinkoi).toBe("https://pinkoi.com/store/testbrand");
    expect(brand.purchaseShopee).toBe("https://shopee.tw/testbrand");
  });

  it("maps other_urls JSONB to domain array", () => {
    const row = makeBrandRow({
      other_urls: [{ label: "PChome", url: "https://pchome.com/store" }],
    });
    const brand = brandToDomain(row);
    expect(brand.otherUrls).toEqual([
      { label: "PChome", url: "https://pchome.com/store" },
    ]);
  });

  it("defaults null columns to null and empty array", () => {
    const row = makeBrandRow();
    const brand = brandToDomain(row);
    expect(brand.socialInstagram).toBeNull();
    expect(brand.purchaseWebsite).toBeNull();
    expect(brand.otherUrls).toEqual([]);
  });
});

describe("brandToDomain — brand detail enrichment fields", () => {
  it("maps subcategories to subcategories", () => {
    const row = makeBrandRow({ subcategories: ["cotton", "handmade"] });
    const brand = brandToDomain(row);
    expect(brand.subcategories).toEqual(["cotton", "handmade"]);
  });

  it("defaults subcategories to [] when subcategories is null", () => {
    const row = makeBrandRow({ subcategories: null });
    const brand = brandToDomain(row);
    expect(brand.subcategories).toEqual([]);
  });
});

describe("brandToInsert — isDemo", () => {
  it("maps isDemo true to is_demo true", () => {
    const result = brandToInsert({ isDemo: true });
    expect(result.is_demo).toBe(true);
  });

  it("does not include is_demo when isDemo is false", () => {
    const result = brandToInsert({ isDemo: false });
    expect(result).not.toHaveProperty("is_demo");
  });

  it("does not include is_demo when isDemo is undefined", () => {
    const result = brandToInsert({ name: "Test" });
    expect(result).not.toHaveProperty("is_demo");
  });
});

describe("brandToInsert — romanized name", () => {
  it("serializes romanizedName to romanized_name", () => {
    expect(brandToInsert({ romanizedName: "Warmwood Living" })).toMatchObject({
      romanized_name: "Warmwood Living",
    });
  });
});

describe("brandToInsert (flat link columns)", () => {
  it("serializes flat link fields to snake_case columns", () => {
    const result = brandToInsert({
      socialInstagram: "test_brand",
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: "https://testbrand.com",
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [{ label: "Blog", url: "https://blog.test.com" }],
    });
    expect(result.social_instagram).toBe("test_brand");
    expect(result.social_threads).toBeNull();
    expect(result.purchase_website).toBe("https://testbrand.com");
    expect(result.other_urls).toEqual([
      { label: "Blog", url: "https://blog.test.com" },
    ]);
  });
});

describe("brandToInsert — brand detail enrichment fields", () => {
  it("serializes non-empty subcategories to subcategories", () => {
    const result = brandToInsert({ subcategories: ["minimal", "gift"] });
    expect(result.subcategories).toEqual(["minimal", "gift"]);
  });

  it("serializes empty subcategories as [] to allow clearing the field", () => {
    const result = brandToInsert({ subcategories: [] });
    expect(result.subcategories).toEqual([]);
  });
});
