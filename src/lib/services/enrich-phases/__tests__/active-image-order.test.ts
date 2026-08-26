import { describe, expect, it } from "vitest";
import { MAX_BRAND_ACTIVE_IMAGES } from "@/lib/constants/brand-images";
import {
  planActiveImageOrder,
  type ActiveImageForOrdering,
} from "../classify-images";

function row(
  id: string,
  overrides: Partial<ActiveImageForOrdering> = {},
): ActiveImageForOrdering {
  return { id, source: "google_image", sort_order: 0, ...overrides };
}

describe("planActiveImageOrder", () => {
  it("gives unjudged active images distinct sort_orders instead of leaving them all at 0", () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [row("judged"), row("unjudged-a"), row("unjudged-b")],
      rankedJudgedIds: ["judged"],
    });

    expect(demotedIds).toEqual([]);
    expect(assignments).toEqual([
      { id: "judged", sortOrder: 0 },
      { id: "unjudged-a", sortOrder: 1 },
      { id: "unjudged-b", sortOrder: 2 },
    ]);
    // The invariant the database enforces: exactly one row at position 0.
    expect(assignments.filter((a) => a.sortOrder === 0)).toHaveLength(1);
    expect(new Set(assignments.map((a) => a.sortOrder)).size).toBe(
      assignments.length,
    );
  });

  it("ranks judged images ahead of unjudged ones so an unranked image cannot become the hero", () => {
    const { assignments } = planActiveImageOrder({
      // Unjudged rows arrive first, but must not win position 0.
      activeImages: [row("unjudged"), row("best"), row("second")],
      rankedJudgedIds: ["best", "second"],
    });

    expect(assignments.map((a) => a.id)).toEqual([
      "best",
      "second",
      "unjudged",
    ]);
    expect(assignments.at(0)).toEqual({ id: "best", sortOrder: 0 });
  });

  it("keeps a human pick at its reserved position and never demotes it", () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [
        row("admin-hero", { source: "admin", sort_order: 0 }),
        row("judged"),
        row("unjudged"),
      ],
      rankedJudgedIds: ["judged"],
    });

    // The admin row is untouched, and nothing else is handed position 0.
    expect(assignments.map((a) => a.id)).not.toContain("admin-hero");
    expect(demotedIds).not.toContain("admin-hero");
    expect(assignments.some((a) => a.sortOrder === 0)).toBe(false);
    expect(assignments).toEqual([
      { id: "judged", sortOrder: 1 },
      { id: "unjudged", sortOrder: 2 },
    ]);
  });

  it("caps active images at the cap and demotes the lowest ranked overflow", () => {
    const overflow = 3;
    const ids = Array.from(
      { length: MAX_BRAND_ACTIVE_IMAGES + overflow },
      (_, i) => `img-${i}`,
    );
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: ids.map((id) => row(id)),
      rankedJudgedIds: ids,
    });

    expect(assignments).toHaveLength(MAX_BRAND_ACTIVE_IMAGES);
    expect(assignments.map((a) => a.sortOrder)).toEqual(
      Array.from({ length: MAX_BRAND_ACTIVE_IMAGES }, (_, i) => i),
    );
    expect(demotedIds).toEqual(ids.slice(MAX_BRAND_ACTIVE_IMAGES));
  });

  it("counts human picks against the cap", () => {
    const reserved = 2;
    const classifierImages = MAX_BRAND_ACTIVE_IMAGES;
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [
        row("owner-1", { source: "owner", sort_order: 0 }),
        row("owner-2", { source: "owner", sort_order: 1 }),
        ...Array.from({ length: classifierImages }, (_, i) => row(`img-${i}`)),
      ],
      rankedJudgedIds: Array.from(
        { length: classifierImages },
        (_, i) => `img-${i}`,
      ),
    });

    // Owner picks hold slots 0 and 1, so the classifier gets the rest.
    const expected = MAX_BRAND_ACTIVE_IMAGES - reserved;
    expect(assignments).toHaveLength(expected);
    expect(assignments.map((a) => a.sortOrder)).toEqual(
      Array.from({ length: expected }, (_, i) => i + reserved),
    );
    expect(demotedIds).toHaveLength(classifierImages - expected);
  });

  it("sorts product images ahead of a higher-scoring logo (product_images_sort_ahead_of_logo)", () => {
    const { assignments } = planActiveImageOrder({
      activeImages: [
        row("logo-1", { tags: ["logo"] }),
        row("product-1", { tags: ["product"] }),
        row("product-2", { tags: ["product"] }),
      ],
      // The logo ranks first by quality, but products must still lead.
      rankedJudgedIds: ["logo-1", "product-1", "product-2"],
    });

    const productOrders = assignments
      .filter((a) => a.id.startsWith("product"))
      .map((a) => a.sortOrder);
    const logoAssignment = assignments.find((a) => a.id === "logo-1")!;
    expect(productOrders.every((o) => o < logoAssignment.sortOrder)).toBe(true);
    // Products keep their quality ranking among themselves.
    expect(
      assignments.filter((a) => a.id.startsWith("product")).map((a) => a.id),
    ).toEqual(["product-1", "product-2"]);
  });

  it("allows at most one logo within the active cap (at_most_one_logo_within_the_active_cap)", () => {
    const { assignments, demotedIds } = planActiveImageOrder({
      activeImages: [
        row("product-1", { tags: ["product"] }),
        row("logo-1", { tags: ["logo"] }),
        row("logo-2", { tags: ["logo"] }),
      ],
      rankedJudgedIds: ["product-1", "logo-1", "logo-2"],
    });

    // Only one logo within the active cap range.
    const withinCap = assignments.filter(
      (a) => a.sortOrder < MAX_BRAND_ACTIVE_IMAGES,
    );
    const logosWithinCap = withinCap.filter((a) => a.id.startsWith("logo"));
    expect(logosWithinCap).toHaveLength(1);

    // The second logo is assigned past the cap, NOT rejected (not in demotedIds).
    expect(demotedIds).not.toContain("logo-2");
    const secondLogo = assignments.find((a) => a.id === "logo-2");
    expect(secondLogo).toBeDefined();
    expect(secondLogo!.sortOrder).toBeGreaterThanOrEqual(MAX_BRAND_ACTIVE_IMAGES);
  });

  it("handles the all-unjudged case that produced the ten-rows-at-zero bug", () => {
    const { assignments } = planActiveImageOrder({
      activeImages: Array.from({ length: 4 }, (_, i) => row(`scraped-${i}`)),
      rankedJudgedIds: [],
    });

    expect(assignments.map((a) => a.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(assignments.filter((a) => a.sortOrder === 0)).toHaveLength(1);
  });
});
