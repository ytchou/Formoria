/**
 * Pure scoring and sampling logic for the acquisition-agent cohort census.
 * No Supabase client — only the exported functions that compute a quality
 * score and draw a deterministic bottom-quartile sample.
 */
import { describe, expect, it } from "vitest";

import {
  type BrandSignals,
  computeQualityScore,
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
