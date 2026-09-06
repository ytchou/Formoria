import { describe, expect, it } from "vitest";

import {
  probeCandidates,
  type ProbeCandidatesDeps,
  type ProbeCandidatesInput,
  type BrandImageRow,
} from "../probe-candidates";

/**
 * Candidate probe reporter (DEV-1610, Task 9).
 *
 * Every seam is injected — no vi.mock of service or supabase modules
 * (enforced by `scripts/check-test-boundaries.mjs`).
 */

function makeDeps(
  overrides: Partial<ProbeCandidatesDeps> = {},
): {
  deps: ProbeCandidatesDeps;
  calls: { fetchBrandIds: number; fetchBrandImages: string[] };
} {
  const calls = {
    fetchBrandIds: 0,
    fetchBrandImages: [] as string[],
  };

  const deps: ProbeCandidatesDeps = {
    fetchBrandIds:
      overrides.fetchBrandIds ??
      (async (slugs) => {
        calls.fetchBrandIds++;
        return slugs.map((s) => ({ slug: s, id: `brand-${s}` }));
      }),
    fetchBrandImages:
      overrides.fetchBrandImages ??
      (async (brandId) => {
        calls.fetchBrandImages.push(brandId);
        return [];
      }),
  };

  return { deps, calls };
}

function input(
  overrides: Partial<ProbeCandidatesInput> = {},
): ProbeCandidatesInput {
  return {
    slugs: [],
    csvPath: null,
    ...overrides,
  };
}

/** Build a brand_images row with provider_metadata.pageUrl. */
function imageRow(
  id: string,
  pageUrl: string,
  extra?: { title?: string; position?: number; source_url?: string },
): BrandImageRow {
  return {
    id,
    source_url: extra?.source_url ?? null,
    provider_metadata: {
      pageUrl,
      ...(extra?.title ? { title: extra.title } : {}),
      ...(extra?.position !== undefined ? { position: extra.position } : {}),
    },
  };
}

describe("probeCandidates", () => {
  it("summarizes_pool_per_brand", async () => {
    const { deps } = makeDeps({
      fetchBrandIds: async (slugs) =>
        slugs.map((s) => ({ slug: s, id: `brand-${s}` })),
      fetchBrandImages: async (brandId) => {
        if (brandId === "brand-alpha") {
          return [
            // product-detail
            imageRow("i1", "https://alpha.com/products/bag-a"),
            imageRow("i2", "https://alpha.com/products/bag-b"),
            imageRow("i3", "https://alpha.com/products/hat-c"),
            // listing
            imageRow("i4", "https://alpha.com/collections/all"),
            // other
            imageRow("i5", "https://alpha.com/about"),
            // no pageUrl — contributes to storedRowCount but not candidates
            { id: "i6", source_url: null, provider_metadata: {} },
          ];
        }
        if (brandId === "brand-beta") {
          return [
            imageRow("i7", "https://beta.com/products/shoe-a"),
            // duplicate of shoe-a after normalization (trailing slash)
            imageRow("i8", "https://beta.com/products/shoe-a/"),
          ];
        }
        return [];
      },
    });

    const result = await probeCandidates(
      input({ slugs: ["alpha", "beta"] }),
      deps,
    );

    // Alpha: 6 stored rows, 3 product-detail, 1 listing, 1 other, 0 dedupe reduction
    const alpha = result.brands.find((b) => b.slug === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.storedRowCount).toBe(6);
    expect(alpha!.productDetailCount).toBe(3);
    expect(alpha!.listingCount).toBe(1);
    expect(alpha!.dedupeReduction).toBeGreaterThanOrEqual(0);

    // Beta: 2 stored rows, 2 product-detail before dedupe, 1 after (duplicate)
    const beta = result.brands.find((b) => b.slug === "beta");
    expect(beta).toBeDefined();
    expect(beta!.storedRowCount).toBe(2);
    expect(beta!.productDetailCount).toBe(2);
    expect(beta!.dedupeReduction).toBe(1);

    // Total rows scanned printed for truncation visibility
    expect(result.totalRowsScanned).toBe(8);
  });

  it("csv_comparison_matches_normalized_urls", async () => {
    const { deps } = makeDeps({
      fetchBrandIds: async (slugs) =>
        slugs.map((s) => ({ slug: s, id: `brand-${s}` })),
      fetchBrandImages: async () => [
        // Pool has a clean URL
        imageRow("i1", "https://shop.example.com/products/ceramic-mug"),
        imageRow("i2", "https://shop.example.com/products/wooden-tray"),
      ],
    });

    // CSV carries the same page with tracking noise: ?srsltid=...
    const csvContent = [
      "formoria_slug,product_1_url,product_2_url",
      "gamma,https://shop.example.com/products/ceramic-mug?srsltid=abc123&utm_source=google,https://shop.example.com/products/wooden-tray?fbclid=xyz",
    ].join("\n");

    const result = await probeCandidates(
      input({ slugs: ["gamma"], csvPath: "__test__" }),
      deps,
      csvContent,
    );

    expect(result.csvComparison).not.toBeNull();
    // Both CSV URLs match after normalization strips srsltid/utm_source/fbclid
    expect(result.csvComparison!.overall.matched).toBe(2);
    expect(result.csvComparison!.overall.total).toBe(2);
    expect(result.csvComparison!.overall.matchRate).toBeCloseTo(1.0);
  });

  it("reports_shortfall_against_three", async () => {
    const { deps } = makeDeps({
      fetchBrandIds: async (slugs) =>
        slugs.map((s) => ({ slug: s, id: `brand-${s}` })),
      fetchBrandImages: async () => [
        // Only 2 product-detail candidates — below target of 3
        imageRow("i1", "https://example.com/products/item-a"),
        imageRow("i2", "https://example.com/products/item-b"),
        // One listing — does not count toward product-detail target
        imageRow("i3", "https://example.com/collections/new"),
      ],
    });

    const result = await probeCandidates(
      input({ slugs: ["sparse-brand"] }),
      deps,
    );

    const brand = result.brands.find((b) => b.slug === "sparse-brand");
    expect(brand).toBeDefined();
    expect(brand!.afterDedupeProductDetailCount).toBe(2);
    expect(brand!.belowTarget).toBe(true);

    // Exit code reflects the shortfall
    expect(result.exitCode).toBe(1);
  });

  it("is_read_only", async () => {
    const calls: string[] = [];
    const deps: ProbeCandidatesDeps = {
      fetchBrandIds: async (slugs) => {
        calls.push("fetchBrandIds");
        return slugs.map((s) => ({ slug: s, id: `brand-${s}` }));
      },
      fetchBrandImages: async (brandId) => {
        calls.push(`fetchBrandImages:${brandId}`);
        return [
          imageRow("i1", "https://example.com/products/item-a"),
        ];
      },
    };

    const result = await probeCandidates(
      input({ slugs: ["readonly-brand"] }),
      deps,
    );

    // The probe produced a result
    expect(result.brands).toHaveLength(1);
    expect(result.totalRowsScanned).toBe(1);

    // Only read calls were made — no insert, update, delete, or upsert
    expect(calls.every((c) => c.startsWith("fetchBrand"))).toBe(true);
    expect(calls).toHaveLength(2); // one fetchBrandIds + one fetchBrandImages
  });
});
