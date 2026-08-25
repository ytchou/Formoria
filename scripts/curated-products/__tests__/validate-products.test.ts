import { describe, expect, it } from "vitest";

import {
  normalizeUrl,
  validateProducts,
  type ValidateProductsDeps,
  type ValidateProductsInput,
} from "../validate-products";

/**
 * Curated-product validator (DEV-1609).
 *
 * Every seam is injected — no vi.mock of service or supabase modules
 * (enforced by `scripts/check-test-boundaries.mjs`).
 */

function makeDeps(
  overrides: Partial<ValidateProductsDeps> = {},
): {
  deps: ValidateProductsDeps;
  calls: { fetchProducts: Array<string | undefined>; fetchSources: string[][] };
} {
  const calls = {
    fetchProducts: [] as Array<string | undefined>,
    fetchSources: [] as string[][],
  };

  const deps: ValidateProductsDeps = {
    fetchProducts:
      overrides.fetchProducts ??
      (async (brandSlug) => {
        calls.fetchProducts.push(brandSlug);
        return [];
      }),
    fetchSources:
      overrides.fetchSources ??
      (async (productIds) => {
        calls.fetchSources.push(productIds);
        return productIds.map((id) => ({
          curated_product_id: id,
          source_checked_at: "2026-01-01T00:00:00Z",
        }));
      }),
  };

  return { deps, calls };
}

function input(overrides: Partial<ValidateProductsInput> = {}): ValidateProductsInput {
  return {
    brandSlug: null,
    csvPath: null,
    ...overrides,
  };
}

describe("validateProducts", () => {
  it("test_checks_gate_fields_present", async () => {
    const { deps } = makeDeps({
      fetchProducts: async () => [
        {
          id: "p1",
          key: "brand-a/product-1",
          brand_id: "b1",
          product_description_zh: "好產品",
          image_url: null,
          official_url: null,
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p2",
          key: "brand-a/product-2",
          brand_id: "b1",
          product_description_zh: "另一個產品",
          image_url: "https://img.example.com/p2.jpg",
          official_url: "https://brand-a.com/p2",
          visible: true,
          brands: { slug: "brand-a" },
        },
      ],
      fetchSources: async (productIds) =>
        productIds.map((id) => ({
          curated_product_id: id,
          source_checked_at: id === "p1" ? null : "2026-01-01T00:00:00Z",
        })),
    });

    const result = await validateProducts(input(), deps);

    // p1 is missing image_url, official_url, and source_checked_at
    expect(result.gateFailures).toHaveLength(3);
    const p1Failures = result.gateFailures.filter((f) => f.productId === "p1");
    expect(p1Failures).toHaveLength(3);

    const failedFields = p1Failures.map((f) => f.field).sort();
    expect(failedFields).toEqual(["image_url", "official_url", "source_checked_at"]);

    // p2 has all fields
    const p2Failures = result.gateFailures.filter((f) => f.productId === "p2");
    expect(p2Failures).toHaveLength(0);

    expect(result.exitCode).toBe(1);
  });

  it("test_detects_forbidden_terms", async () => {
    const { deps } = makeDeps({
      fetchProducts: async () => [
        {
          id: "p1",
          key: "brand-a/bag",
          brand_id: "b1",
          product_description_zh: "這是一個價格合理的產品",
          image_url: "https://img.example.com/p1.jpg",
          official_url: "https://brand-a.com/bag",
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p2",
          key: "brand-a/hat",
          brand_id: "b1",
          product_description_zh: "必買的好東西，讓你的生活更好",
          image_url: "https://img.example.com/p2.jpg",
          official_url: "https://brand-a.com/hat",
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p3",
          key: "brand-b/shoe",
          brand_id: "b2",
          product_description_zh: "普通的描述",
          image_url: "https://img.example.com/p3.jpg",
          official_url: "https://brand-b.com/shoe",
          visible: true,
          brands: { slug: "brand-b" },
        },
      ],
    });

    const result = await validateProducts(input(), deps);

    // p1 has 價格, p2 has 必買 and 讓你
    expect(result.forbiddenTerms.length).toBeGreaterThanOrEqual(3);

    const p1Terms = result.forbiddenTerms.filter((f) => f.productId === "p1");
    expect(p1Terms.map((t) => t.term)).toContain("價格");

    const p2Terms = result.forbiddenTerms.filter((f) => f.productId === "p2");
    expect(p2Terms.map((t) => t.term)).toContain("必買");
    expect(p2Terms.map((t) => t.term)).toContain("讓你");

    const p3Terms = result.forbiddenTerms.filter((f) => f.productId === "p3");
    expect(p3Terms).toHaveLength(0);

    expect(result.exitCode).toBe(1);
  });

  it("test_csv_comparison_matches_by_url", async () => {
    const { deps } = makeDeps({
      fetchProducts: async () => [
        {
          id: "p1",
          key: "brand-a/product-1",
          brand_id: "b1",
          product_description_zh: "好產品",
          image_url: "https://img.example.com/p1.jpg",
          official_url: "https://Brand-A.com/product-1/",
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p2",
          key: "brand-a/product-2",
          brand_id: "b1",
          product_description_zh: "另一個產品",
          image_url: "https://img.example.com/p2.jpg",
          official_url: "https://brand-a.com/product-2",
          visible: true,
          brands: { slug: "brand-a" },
        },
      ],
    });

    const csvContent = [
      "formoria_slug,product_1_url,product_2_url",
      "brand-a,https://brand-a.com/product-1?ref=test#top,https://brand-a.com/product-2/",
    ].join("\n");

    const result = await validateProducts(input({ csvPath: "__test__" }), deps, csvContent);

    // URL normalization: Brand-A.com/product-1/ == brand-a.com/product-1?ref=test#top
    expect(result.csvComparison).not.toBeNull();
    expect(result.csvComparison!.overall.matched).toBe(2);
    expect(result.csvComparison!.overall.total).toBe(2);
  });

  it("test_csv_comparison_reports_match_rate", async () => {
    const { deps } = makeDeps({
      fetchProducts: async () => [
        {
          id: "p1",
          key: "brand-a/bag",
          brand_id: "b1",
          product_description_zh: "好產品",
          image_url: "https://img.example.com/p1.jpg",
          official_url: "https://brand-a.com/bag",
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p2",
          key: "brand-a/hat",
          brand_id: "b1",
          product_description_zh: "帽子",
          image_url: "https://img.example.com/p2.jpg",
          official_url: "https://brand-a.com/hat",
          visible: true,
          brands: { slug: "brand-a" },
        },
        {
          id: "p3",
          key: "brand-b/shoe",
          brand_id: "b2",
          product_description_zh: "鞋子",
          image_url: "https://img.example.com/p3.jpg",
          official_url: "https://brand-b.com/shoe",
          visible: true,
          brands: { slug: "brand-b" },
        },
      ],
    });

    const csvContent = [
      "formoria_slug,product_1_url,product_2_url",
      "brand-a,https://brand-a.com/bag,https://brand-a.com/WRONG",
      "brand-b,https://brand-b.com/shoe,",
    ].join("\n");

    const result = await validateProducts(input({ csvPath: "__test__" }), deps, csvContent);

    expect(result.csvComparison).not.toBeNull();
    const csv = result.csvComparison!;

    // brand-a: 1 matched out of 2 CSV urls
    const brandA = csv.perBrand.find((b) => b.slug === "brand-a");
    expect(brandA).toBeDefined();
    expect(brandA!.matched).toBe(1);
    expect(brandA!.csvUrls).toBe(2);
    expect(brandA!.matchRate).toBeCloseTo(0.5);

    // brand-b: 1 matched out of 1 CSV url
    const brandB = csv.perBrand.find((b) => b.slug === "brand-b");
    expect(brandB).toBeDefined();
    expect(brandB!.matched).toBe(1);
    expect(brandB!.csvUrls).toBe(1);
    expect(brandB!.matchRate).toBeCloseTo(1.0);

    // overall: 2 matched out of 3 CSV urls
    expect(csv.overall.matched).toBe(2);
    expect(csv.overall.total).toBe(3);
    expect(csv.overall.matchRate).toBeCloseTo(2 / 3);
  });
});

describe("normalizeUrl", () => {
  it("strips trailing slash, lowercases host, drops query and fragment", () => {
    expect(normalizeUrl("https://Brand-A.com/path/")).toBe("https://brand-a.com/path");
    expect(normalizeUrl("https://brand-a.com/path?ref=test#top")).toBe(
      "https://brand-a.com/path",
    );
    expect(normalizeUrl("https://BRAND-A.COM/Path/")).toBe("https://brand-a.com/Path");
  });

  it("handles invalid URLs gracefully", () => {
    expect(normalizeUrl("not-a-url/")).toBe("not-a-url");
    expect(normalizeUrl("  HELLO  ")).toBe("hello");
  });
});
