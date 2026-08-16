import { describe, expect, it } from "vitest";

import type { TrailIndexabilityProduct } from "@/lib/seo/trail-indexability";
import type { TrailEntry } from "@/lib/services/trails";
import { selectIndexableTrails, shouldHideUnderSuppliedTrail } from "../trail-supply";

function trail(slug: string): TrailEntry {
  return {
    slug,
    frontmatter: {
      title: slug,
      description: "A trail",
      slug,
      tags: ["home"],
      locale: "zh-TW",
      publishedAt: "2026-08-15T00:00:00.000Z",
      draft: false,
      sources: ["https://example.com/editorial-source"],
      faq: [],
      promise: "Make one corner easier to use.",
      sections: [{ key: "desk", title: "At the desk" }],
      exclusions: "No renovation advice.",
      editorialOwner: "Formoria editorial",
      reviewedAt: "2026-08-15T00:00:00.000Z",
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    } as TrailEntry["frontmatter"],
  };
}

function fullSlate(): TrailIndexabilityProduct[] {
  return Array.from({ length: 6 }, (_, index) => ({
    l1: "home",
    l2: [index % 2 === 0 ? "lighting" : "furniture"],
    sectionKey: "desk",
  }));
}

describe("selectIndexableTrails", () => {
  it("selects only trails with no blockers", () => {
    const selection = selectIndexableTrails({
      trails: [trail("small-space-reading-corner"), trail("weeknight-kitchen-reset")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["small-space-reading-corner", fullSlate()],
        ["weeknight-kitchen-reset", fullSlate().slice(0, 3)],
      ]),
    });

    expect([...selection.indexableSlugs]).toEqual(["small-space-reading-corner"]);
    expect([...selection.failedSlugs]).toEqual([]);
  });

  it("treats a null product read as not indexable", () => {
    const selection = selectIndexableTrails({
      trails: [trail("small-space-reading-corner")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["small-space-reading-corner", null],
      ]),
    });

    expect(selection.indexableSlugs.has("small-space-reading-corner")).toBe(false);
    // A failed read is "unknown supply", never "empty supply".
    expect([...selection.failedSlugs]).toEqual(["small-space-reading-corner"]);
  });

  it("returns an empty set when every trail is under-supplied", () => {
    const selection = selectIndexableTrails({
      trails: [trail("small-space-reading-corner"), trail("weeknight-kitchen-reset")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["small-space-reading-corner", []],
        ["weeknight-kitchen-reset", []],
      ]),
    });

    expect(selection.indexableSlugs.size).toBe(0);
    expect(selection.failedSlugs.size).toBe(0);
  });
});

describe("shouldHideUnderSuppliedTrail", () => {
  const frontmatter = trail("small-space-reading-corner").frontmatter;

  it("hides an under-supplied slate", () => {
    expect(
      shouldHideUnderSuppliedTrail({
        frontmatter,
        products: fullSlate().slice(0, 3),
      }),
    ).toBe(true);
  });

  it("never hides on a failed read", () => {
    // The regression guard that matters most: `null` is a failed read, and a
    // failed read must never bake a 404 for a trail that has content.
    expect(shouldHideUnderSuppliedTrail({ frontmatter, products: null })).toBe(false);
  });

  it("keeps a fully supplied slate visible", () => {
    expect(shouldHideUnderSuppliedTrail({ frontmatter, products: fullSlate() })).toBe(
      false,
    );
  });

  it("keeps a trail visible when a non-min_products blocker trips", () => {
    // Accepted asymmetry: only `min_products` 404s. Every other blocker leaves
    // the page reachable and merely noindex — do not "fix" this by widening it.
    const withEmptySection: TrailEntry["frontmatter"] = {
      ...frontmatter,
      sections: [
        { key: "desk", title: "At the desk" },
        { key: "shelf", title: "On the shelf" },
      ],
    };

    expect(
      shouldHideUnderSuppliedTrail({
        frontmatter: withEmptySection,
        products: fullSlate(),
      }),
    ).toBe(false);
  });
});
