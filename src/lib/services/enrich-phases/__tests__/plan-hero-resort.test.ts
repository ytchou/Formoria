import { describe, expect, it } from "vitest";
import {
  MAX_BRAND_ACTIVE_IMAGES,
  MAX_BRAND_ACTIVE_SORT_ORDER,
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
});
