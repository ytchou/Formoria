import { describe, expect, it } from "vitest";
import {
  MAX_BRAND_ACTIVE_IMAGES,
  MAX_BRAND_ACTIVE_SORT_ORDER,
  MIN_CANDIDATE_SCORE,
} from "@/lib/constants/brand-images";
import {
  planHeroResort,
  type BrandImageForClassification,
} from "../classify-images";

function row(
  id: string,
  sortOrder: number,
  overrides: Partial<BrandImageForClassification> = {},
): BrandImageForClassification {
  return {
    id,
    brand_id: "brand-1",
    url: `https://cdn.example/${id}.jpg`,
    source: "google_image",
    status: "active",
    tags: ["product"],
    score: 80,
    sort_order: sortOrder,
    width: 1200,
    height: 900,
    ...overrides,
  };
}

describe("planHeroResort", () => {
  it("refuses active junk without proposing writes", () => {
    const plan = planHeroResort({
      activeImages: [row("junk", 0, { tags: ["promo"] })],
      mode: "resort",
    });

    expect(plan.skipReason).toBe("junk_tagged_active");
    expect(plan.assignments).toEqual([]);
    expect(plan.demotedIds).toEqual([]);
    expect(plan.rejectedUpdates).toEqual([]);
  });

  it("refuses over-capacity brands before classification can demote rows", () => {
    const plan = planHeroResort({
      activeImages: Array.from(
        { length: MAX_BRAND_ACTIVE_IMAGES + 1 },
        (_, i) => row(`image-${i}`, i),
      ),
      mode: "resort",
    });

    expect(plan.skipReason).toBe("over_capacity");
    expect(plan.assignments).toEqual([]);
    expect(plan.demotedIds).toEqual([]);
  });

  it("reserves exempt rows, counts them against capacity, and never assigns them", () => {
    const plan = planHeroResort({
      activeImages: [
        row("owner", 0, { source: "owner" }),
        ...Array.from({ length: MAX_BRAND_ACTIVE_IMAGES - 1 }, (_, i) =>
          row(`managed-${i}`, i + 1, { score: 90 - i }),
        ),
      ],
      mode: "resort",
    });

    expect(plan.demotedIds).toEqual([]);
    expect(plan.assignments.map(({ id }) => id)).not.toContain("owner");
    expect(plan.assignments).toHaveLength(MAX_BRAND_ACTIVE_IMAGES - 1);
    expect(plan.assignments.every(({ sortOrder }) => sortOrder > 0)).toBe(true);
  });

  it("keeps assignments unique and inside the active range", () => {
    const plan = planHeroResort({
      activeImages: [row("a", 8, { score: 95 }), row("b", 9, { score: 90 })],
      mode: "resort",
    });

    const sortOrders = plan.assignments.map(({ sortOrder }) => sortOrder);
    expect(new Set(sortOrders).size).toBe(sortOrders.length);
    expect(
      sortOrders.every(
        (value) => value >= 0 && value <= MAX_BRAND_ACTIVE_SORT_ORDER,
      ),
    ).toBe(true);
  });

  it("keeps a logo-only brand's images with a logo hero (logo_only_brand_keeps_its_images)", () => {
    const plan = planHeroResort({
      activeImages: [
        row("logo-1", 0, { tags: ["logo"], score: 90 }),
        row("logo-2", 1, { tags: ["logo"], score: 80 }),
      ],
      mode: "resort",
    });

    expect(plan.skipReason).toBeNull();
    expect(plan.assignments.length).toBeGreaterThan(0);
    // Neither logo is demoted or rejected.
    expect(plan.demotedIds).toEqual([]);
    expect(plan.rejectedUpdates).toEqual([]);
    // The hero (sort_order 0) exists.
    expect(plan.assignments.some((a) => a.sortOrder === 0)).toBe(true);
  });

  it("is idempotent after applying its planned ordering", () => {
    const original = [
      row("low", 0, { score: 70 }),
      row("high", 1, { score: 95 }),
    ];
    const first = planHeroResort({ activeImages: original, mode: "resort" });
    const reordered = original.map((image) => ({
      ...image,
      sort_order:
        first.assignments.find(({ id }) => id === image.id)?.sortOrder ??
        image.sort_order,
    }));
    const second = planHeroResort({ activeImages: reordered, mode: "resort" });

    expect(second.assignments).toEqual(first.assignments);
    expect(
      second.assignments.every(
        ({ id, sortOrder }) =>
          reordered.find((image) => image.id === id)?.sort_order === sortOrder,
      ),
    ).toBe(true);
    expect(second.demotedIds).toEqual([]);
  });

  it("classify_mode_routes_overflow_by_min_candidate_score", () => {
    // Over-capacity in classify mode: 12 active images, scores descending.
    // The first 10 fit the cap; overflow is split by MIN_CANDIDATE_SCORE.
    const images = Array.from({ length: 12 }, (_, i) =>
      row(`img-${i}`, i, { score: 95 - i * 3 }),
    );
    const plan = planHeroResort({ activeImages: images, mode: "classify" });

    // Classify mode does not skip on over_capacity (resort mode does).
    expect(plan.skipReason).toBeNull();
    expect(plan.assignments).toHaveLength(MAX_BRAND_ACTIVE_IMAGES);

    // img-10 has score 65, img-11 has score 62 — both < MIN_CANDIDATE_SCORE
    const highOverflow = plan.candidateIds;
    const lowOverflow = plan.demotedIds;
    // All overflow with score >= MIN_CANDIDATE_SCORE are candidates.
    // All overflow with score < MIN_CANDIDATE_SCORE are demoted.
    for (const id of highOverflow) {
      const img = images.find((row) => row.id === id)!;
      expect(img.score).toBeGreaterThanOrEqual(MIN_CANDIDATE_SCORE);
    }
    for (const id of lowOverflow) {
      const img = images.find((row) => row.id === id)!;
      expect(Number(img.score)).toBeLessThan(MIN_CANDIDATE_SCORE);
    }

    // Resort mode still refuses over-capacity (existing test at :44).
    const resortPlan = planHeroResort({
      activeImages: images,
      mode: "resort",
    });
    expect(resortPlan.skipReason).toBe("over_capacity");
  });
});
