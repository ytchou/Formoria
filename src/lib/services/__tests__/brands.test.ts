import { describe, it, expect, vi } from "vitest";
import {
  brandToDomain,
  brandToInsert,
  extractLatinRun,
  generateSlug,
  getExploreBrands,
} from "../brands";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import type { Brand } from "@/lib/types/brand";

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

// ---------------------------------------------------------------------------
// getExploreBrands (DEV-1743)
//
// Every DB touch is injected. The SQL itself — the `[E2E-TEST]%` exclusion and
// the per-category `row_number()` cap — is asserted as migration text in
// explore-brand-pool.contract.test.ts; re-implementing it here in JS would
// only test the fixture. What is tested here is the wiring: the params the RPC
// is called with, and how its response shape becomes the rail.
// ---------------------------------------------------------------------------

describe("getExploreBrands", () => {
  const firstCategory = VISIBLE_L1_CATEGORIES[0].slug;
  const secondCategory = VISIBLE_L1_CATEGORIES[1].slug;

  function makeBrand(slug: string, category: string): Brand {
    return brandToDomain(
      makeBrandRow({ id: `id-${slug}`, slug, name: slug, category }),
    );
  }

  function brandMap(brands: Brand[]): Map<string, Brand> {
    return new Map(brands.map((brand) => [brand.slug, brand]));
  }

  it("passes the visible L1 slugs, the per-category cap and a text seed", async () => {
    const rpcCaller = vi.fn().mockResolvedValue([]);

    await getExploreBrands({
      rpcCaller,
      countReader: async () => 0,
      brandLoader: async () => new Map(),
    });

    const params = rpcCaller.mock.calls[0][0];
    expect(params.categorySlugs).toEqual(
      VISIBLE_L1_CATEGORIES.map(({ slug }) => slug),
    );
    expect(params.perCategory).toBe(3);
    // `seed text` in SQL; getDailySeed() returns a YYYYMMDD number.
    expect(typeof params.seed).toBe("string");
    expect(params.seed).toMatch(/^\d{8}$/);
  });

  it("hydrates the RPC slugs and groups the rail by visible-L1 order", async () => {
    const brands = [
      makeBrand("alpha", firstCategory),
      makeBrand("beta", firstCategory),
      makeBrand("gamma", secondCategory),
    ];

    const result = await getExploreBrands({
      // Deliberately interleaved: the RPC's window carries no cross-partition
      // ORDER BY, so the grouping must be re-imposed by the caller.
      rpcCaller: async () => [
        { brand_id: "id-gamma", brand_slug: "gamma", category: secondCategory },
        { brand_id: "id-alpha", brand_slug: "alpha", category: firstCategory },
        { brand_id: "id-beta", brand_slug: "beta", category: firstCategory },
      ],
      countReader: async () => 795,
      brandLoader: async () => brandMap(brands),
    });

    expect(result.brands.map((brand) => brand.slug)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("reports the corpus count from the count reader, not the sampled rows", async () => {
    const result = await getExploreBrands({
      rpcCaller: async () => [
        { brand_id: "id-alpha", brand_slug: "alpha", category: firstCategory },
      ],
      countReader: async () => 795,
      brandLoader: async () => brandMap([makeBrand("alpha", firstCategory)]),
    });

    expect(result.brands).toHaveLength(1);
    expect(result.totalCount).toBe(795);
  });

  it("drops slugs the hydration did not return", async () => {
    const result = await getExploreBrands({
      rpcCaller: async () => [
        { brand_id: "id-alpha", brand_slug: "alpha", category: firstCategory },
        { brand_id: "id-ghost", brand_slug: "ghost", category: firstCategory },
      ],
      countReader: async () => 2,
      brandLoader: async () => brandMap([makeBrand("alpha", firstCategory)]),
    });

    expect(result.brands.map((brand) => brand.slug)).toEqual(["alpha"]);
  });

  it("asks the loader only for the slugs the RPC selected", async () => {
    const brandLoader = vi.fn().mockResolvedValue(new Map());

    await getExploreBrands({
      rpcCaller: async () => [
        { brand_id: "id-alpha", brand_slug: "alpha", category: firstCategory },
      ],
      countReader: async () => 1,
      brandLoader,
    });

    expect(brandLoader).toHaveBeenCalledWith(["alpha"]);
  });
});
