/**
 * Pure scoring and sampling logic for the acquisition-agent cohort census.
 * No Supabase client — only the exported functions that compute a quality
 * score, draw a deterministic bottom-quartile sample, classify products as
 * discoverable, bucket brands by purchase surface, parse last-run reasons,
 * chunk zero-coverage cohorts, and assemble coverage reports.
 */
import { describe, expect, it } from "vitest";

import type { PhaseResult } from "@/lib/types/curation";

import {
  type BrandSignals,
  type ZeroBrandEntry,
  bucketBrand,
  buildZeroCoverageReport,
  chunkZeroCohorts,
  computeQualityScore,
  isDiscoverable,
  lastRunReason,
  sampleBottomQuartile,
} from "../select-cohort";

// ---------------------------------------------------------------------------
// computeQualityScore
// ---------------------------------------------------------------------------

describe("computeQualityScore", () => {
  it("quality_score_counts_filled_signals — full brand scores 3 (desc + website + images)", () => {
    const brand: BrandSignals = {
      slug: "alpha",
      description: "A fine brand",
      purchase_website: "https://alpha.com",
      social_instagram: null,
      approved_image_count: 3,
      published_product_count: 0,
      channel_count: 0,
    };
    expect(computeQualityScore(brand)).toBe(3);
  });

  it("quality_score_counts_filled_signals — empty brand scores 0", () => {
    const brand: BrandSignals = {
      slug: "empty",
      description: null,
      purchase_website: null,
      social_instagram: null,
      approved_image_count: 0,
      published_product_count: 0,
      channel_count: 0,
    };
    expect(computeQualityScore(brand)).toBe(0);
  });

  it("counts all six signals when fully populated", () => {
    const brand: BrandSignals = {
      slug: "full",
      description: "Exists",
      purchase_website: "https://full.com",
      social_instagram: "https://instagram.com/full",
      approved_image_count: 5,
      published_product_count: 2,
      channel_count: 1,
    };
    expect(computeQualityScore(brand)).toBe(6);
  });

  it("does not count images below threshold of 3", () => {
    const brand: BrandSignals = {
      slug: "few-images",
      description: "Exists",
      purchase_website: null,
      social_instagram: null,
      approved_image_count: 2,
      published_product_count: 0,
      channel_count: 0,
    };
    expect(computeQualityScore(brand)).toBe(1);
  });

  it("treats empty string the same as null", () => {
    const brand: BrandSignals = {
      slug: "empty-strings",
      description: "",
      purchase_website: "",
      social_instagram: "",
      approved_image_count: 0,
      published_product_count: 0,
      channel_count: 0,
    };
    expect(computeQualityScore(brand)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sampleBottomQuartile
// ---------------------------------------------------------------------------

describe("sampleBottomQuartile", () => {
  // Build a population where scores range 0–6 evenly enough to have a clear Q1.
  function makeBrands(count: number): Array<{ slug: string; score: number }> {
    return Array.from({ length: count }, (_, i) => ({
      slug: `brand-${String(i).padStart(3, "0")}`,
      score: i % 7, // scores cycle 0–6
    }));
  }

  it("bottom_quartile_sample_is_deterministic_with_seed — same seed produces same slugs", () => {
    const brands = makeBrands(100);
    const a = sampleBottomQuartile(brands, 10, 42);
    const b = sampleBottomQuartile(brands, 10, 42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
  });

  it("different seed produces different slugs", () => {
    const brands = makeBrands(100);
    const a = sampleBottomQuartile(brands, 10, 42);
    const b = sampleBottomQuartile(brands, 10, 99);
    // With 100 brands, different seeds should almost certainly differ
    expect(a).not.toEqual(b);
  });

  it("all sampled brands come from the lowest-quartile set", () => {
    const brands = makeBrands(100);
    const sampled = sampleBottomQuartile(brands, 10, 42);

    // Find Q1 threshold
    const scores = brands.map((b) => b.score).sort((a, b) => a - b);
    const q1Index = Math.floor(scores.length * 0.25);
    const q1Value = scores[q1Index];

    const bottomQuartileSlugs = new Set(
      brands.filter((b) => b.score <= q1Value).map((b) => b.slug),
    );

    for (const slug of sampled) {
      expect(bottomQuartileSlugs.has(slug)).toBe(true);
    }
  });

  it("returns fewer than requested when bottom quartile is too small", () => {
    // Only 4 brands total — bottom quartile has ~1 brand
    const brands = [
      { slug: "a", score: 0 },
      { slug: "b", score: 3 },
      { slug: "c", score: 4 },
      { slug: "d", score: 6 },
    ];
    const sampled = sampleBottomQuartile(brands, 10, 42);
    expect(sampled.length).toBeLessThanOrEqual(4);
    expect(sampled.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isDiscoverable
// ---------------------------------------------------------------------------

describe("isDiscoverable", () => {
  const base = {
    id: "p1",
    visible: true,
    official_url: "https://example.com/product",
    source_checked_at: "2026-01-01T00:00:00Z",
    subcategory: "skincare",
  };
  const activeIds = new Set(["p1"]);

  it("isDiscoverable_requires_all_five_gates", () => {
    // All five gates present → discoverable
    expect(isDiscoverable(base, activeIds)).toBe(true);

    // Each single missing gate → false
    expect(isDiscoverable({ ...base, visible: false }, activeIds)).toBe(false);
    expect(isDiscoverable({ ...base, official_url: null }, activeIds)).toBe(
      false,
    );
    expect(
      isDiscoverable({ ...base, source_checked_at: null }, activeIds),
    ).toBe(false);
    expect(isDiscoverable({ ...base, subcategory: null }, activeIds)).toBe(
      false,
    );
    expect(isDiscoverable(base, new Set())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bucketBrand
// ---------------------------------------------------------------------------

describe("bucketBrand", () => {
  const none = {
    purchase_website: null,
    purchase_shopee: null,
    purchase_pinkoi: null,
    purchase_myship: null,
    social_instagram: null,
    social_facebook: null,
    social_threads: null,
  };

  it("bucketBrand_classifies_by_purchase_surface", () => {
    // Own website → site:own
    expect(
      bucketBrand({ ...none, purchase_website: "https://mybrand.com" }),
    ).toBe("site:own");

    // Known platform hosts → site:<platform>
    expect(
      bucketBrand({
        ...none,
        purchase_website: "https://mybrand.wix.com/shop",
      }),
    ).toBe("site:wix");
    expect(
      bucketBrand({ ...none, purchase_website: "https://shopee.tw/mybrand" }),
    ).toBe("site:shopee");
    expect(
      bucketBrand({
        ...none,
        purchase_website: "https://www.pinkoi.com/store/mybrand",
      }),
    ).toBe("site:pinkoi");
    expect(
      bucketBrand({ ...none, purchase_website: "https://linktr.ee/mybrand" }),
    ).toBe("site:linktr");

    // No website + marketplace purchase link → no-site:marketplace
    expect(
      bucketBrand({ ...none, purchase_shopee: "https://shopee.tw/mybrand" }),
    ).toBe("no-site:marketplace");
    expect(
      bucketBrand({ ...none, purchase_pinkoi: "https://pinkoi.com/mybrand" }),
    ).toBe("no-site:marketplace");
    expect(
      bucketBrand({ ...none, purchase_myship: "https://myship.com/x" }),
    ).toBe("no-site:marketplace");

    // No website, no marketplace + social → no-site:social-only
    expect(
      bucketBrand({ ...none, social_instagram: "https://instagram.com/x" }),
    ).toBe("no-site:social-only");
    expect(
      bucketBrand({ ...none, social_facebook: "https://facebook.com/x" }),
    ).toBe("no-site:social-only");
    expect(
      bucketBrand({ ...none, social_threads: "https://threads.net/@x" }),
    ).toBe("no-site:social-only");

    // Nothing at all → no-site:nothing
    expect(bucketBrand(none)).toBe("no-site:nothing");
  });
});

// ---------------------------------------------------------------------------
// lastRunReason
// ---------------------------------------------------------------------------

describe("lastRunReason", () => {
  function makePhaseResult(
    overrides: Partial<PhaseResult> & { phase: string },
  ): PhaseResult {
    return {
      status: "succeeded",
      changedFields: [],
      durationMs: 100,
      ...overrides,
    };
  }

  it("lastRunReason_reads_products_phase_result", () => {
    // catalogZeroReason wins
    expect(
      lastRunReason([
        makePhaseResult({
          phase: "products",
          catalogZeroReason: "no_catalog",
        }),
      ]),
    ).toBe("no_catalog");

    // productsProposed > 0 → proposed>0
    expect(
      lastRunReason([
        makePhaseResult({ phase: "products", productsProposed: 3 }),
      ]),
    ).toBe("proposed>0");

    // detail → first 60 chars
    const longDetail =
      "Something happened that was quite long and exceeds sixty characters in length easily";
    expect(
      lastRunReason([
        makePhaseResult({ phase: "products", detail: longDetail }),
      ]),
    ).toBe(`detail:${longDetail.slice(0, 60)}`);

    // error fallback when no detail
    expect(
      lastRunReason([
        makePhaseResult({ phase: "products", error: "timeout" }),
      ]),
    ).toBe("detail:timeout");

    // no products phase → absent
    expect(lastRunReason([makePhaseResult({ phase: "acquire" })])).toBe(
      "absent",
    );
    expect(lastRunReason([])).toBe("absent");
  });
});

// ---------------------------------------------------------------------------
// chunkZeroCohorts
// ---------------------------------------------------------------------------

describe("chunkZeroCohorts", () => {
  function makeZeroBrands(): ZeroBrandEntry[] {
    const brands: ZeroBrandEntry[] = [];
    // 83 own-site
    for (let i = 1; i <= 83; i++) {
      brands.push({
        slug: `own-${String(i).padStart(3, "0")}`,
        bucket: "site:own",
        reason: "absent",
      });
    }
    // 1 site:wix — folded into own-site chunk bucket
    brands.push({ slug: "wix-001", bucket: "site:wix", reason: "absent" });
    // 29 marketplace
    for (let i = 1; i <= 29; i++) {
      brands.push({
        slug: `mp-${String(i).padStart(3, "0")}`,
        bucket: "no-site:marketplace",
        reason: "absent",
      });
    }
    // 13 social
    for (let i = 1; i <= 13; i++) {
      brands.push({
        slug: `soc-${String(i).padStart(3, "0")}`,
        bucket: "no-site:social-only",
        reason: "absent",
      });
    }
    return brands;
  }

  it("chunkZeroCohorts_emits_smoke_then_bucket_chunks", () => {
    const brands = makeZeroBrands();
    expect(brands).toHaveLength(126);

    const result = chunkZeroCohorts(brands, {
      seed: 1689,
      smoke: 10,
      chunk: 25,
      prefix: "dev-1689",
    });

    // ---- smoke: 10 brands, proportional, at least one per bucket ----
    expect(result.smoke.slugs).toHaveLength(10);

    const hasOwnSite = result.smoke.slugs.some(
      (s) => s.startsWith("own-") || s.startsWith("wix-"),
    );
    const hasMarketplace = result.smoke.slugs.some((s) =>
      s.startsWith("mp-"),
    );
    const hasSocial = result.smoke.slugs.some((s) => s.startsWith("soc-"));
    expect(hasOwnSite).toBe(true);
    expect(hasMarketplace).toBe(true);
    expect(hasSocial).toBe(true);

    // ---- all.json lists all 126 ----
    expect(result.all.slugs).toHaveLength(126);

    // ---- disjointness: smoke vs chunks ----
    const smokeSet = new Set(result.smoke.slugs);
    const chunkSlugCounts = new Map<string, number>();
    for (const chunk of result.chunks) {
      for (const slug of chunk.slugs) {
        chunkSlugCounts.set(slug, (chunkSlugCounts.get(slug) ?? 0) + 1);
      }
    }

    for (const brand of brands) {
      if (smokeSet.has(brand.slug)) {
        // No smoke slug appears in any chunk file
        expect(chunkSlugCounts.has(brand.slug)).toBe(false);
      } else {
        // Every non-smoke brand appears in exactly one chunk
        expect(chunkSlugCounts.get(brand.slug)).toBe(1);
      }
    }

    // ---- chunk sizes ≤25, only last file per bucket short ----
    const chunksByBucket = new Map<string, typeof result.chunks>();
    for (const chunk of result.chunks) {
      const list = chunksByBucket.get(chunk.bucket) ?? [];
      list.push(chunk);
      chunksByBucket.set(chunk.bucket, list);
    }

    for (const [, bucketChunks] of chunksByBucket) {
      for (let i = 0; i < bucketChunks.length; i++) {
        expect(bucketChunks[i].slugs.length).toBeLessThanOrEqual(25);
        if (i < bucketChunks.length - 1) {
          // Non-last chunks must be exactly full
          expect(bucketChunks[i].slugs.length).toBe(25);
        }
      }
    }

    // ---- deterministic across two calls ----
    const result2 = chunkZeroCohorts(brands, {
      seed: 1689,
      smoke: 10,
      chunk: 25,
      prefix: "dev-1689",
    });
    expect(result.smoke.slugs).toEqual(result2.smoke.slugs);
    expect(result.chunks.map((c) => c.slugs)).toEqual(
      result2.chunks.map((c) => c.slugs),
    );
  });
});

// ---------------------------------------------------------------------------
// buildZeroCoverageReport
// ---------------------------------------------------------------------------

describe("buildZeroCoverageReport", () => {
  it("zeroCoverageReport_counts_state_rows_scanned", () => {
    const scanned = {
      brands: 200,
      products: 500,
      sources: 300,
      targets: 50,
    };
    const zeroBrands: ZeroBrandEntry[] = [
      { slug: "a", bucket: "site:own", reason: "absent" },
      { slug: "b", bucket: "site:own", reason: "no_catalog" },
      { slug: "c", bucket: "no-site:marketplace", reason: "absent" },
      { slug: "d", bucket: "no-site:social-only", reason: "proposed>0" },
      { slug: "e", bucket: "no-site:nothing", reason: "detail:timeout" },
    ];

    const report = buildZeroCoverageReport(scanned, zeroBrands, 195);

    // scanned counts are passed through
    expect(report.scanned).toEqual(scanned);
    expect(report.zero).toBe(5);
    expect(report.covered).toBe(195);
    expect(report.total).toBe(200);

    // bucket counts sum to zero total
    const bucketSum = Object.values(report.bucketCounts).reduce(
      (s, n) => s + n,
      0,
    );
    expect(bucketSum).toBe(report.zero);
    expect(report.bucketCounts["site:own"]).toBe(2);
    expect(report.bucketCounts["no-site:marketplace"]).toBe(1);
    expect(report.bucketCounts["no-site:social-only"]).toBe(1);
    expect(report.bucketCounts["no-site:nothing"]).toBe(1);

    // reason counts sum to zero total
    const reasonSum = Object.values(report.reasonCounts).reduce(
      (s, n) => s + n,
      0,
    );
    expect(reasonSum).toBe(report.zero);
    expect(report.reasonCounts["absent"]).toBe(2);
    expect(report.reasonCounts["no_catalog"]).toBe(1);
    expect(report.reasonCounts["proposed>0"]).toBe(1);
    expect(report.reasonCounts["detail:timeout"]).toBe(1);
  });
});
