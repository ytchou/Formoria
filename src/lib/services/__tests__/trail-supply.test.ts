import { describe, expect, it } from "vitest";

import type { TrailIndexabilityProduct } from "@/lib/seo/trail-indexability";
import type { TrailEntry } from "@/lib/services/trails";
import { selectIndexableTrails } from "../trail-supply";

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
      trails: [trail("supplied"), trail("thin")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["supplied", fullSlate()],
        ["thin", fullSlate().slice(0, 3)],
      ]),
    });

    expect([...selection.indexableSlugs]).toEqual(["supplied"]);
    expect([...selection.failedSlugs]).toEqual([]);
  });

  it("treats a null product read as not indexable", () => {
    const selection = selectIndexableTrails({
      trails: [trail("unreadable")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["unreadable", null],
      ]),
    });

    expect(selection.indexableSlugs.has("unreadable")).toBe(false);
    // A failed read is "unknown supply", never "empty supply".
    expect([...selection.failedSlugs]).toEqual(["unreadable"]);
  });

  it("returns an empty set when every trail is under-supplied", () => {
    const selection = selectIndexableTrails({
      trails: [trail("a"), trail("b")],
      productsBySlug: new Map<string, TrailIndexabilityProduct[] | null>([
        ["a", []],
        ["b", []],
      ]),
    });

    expect(selection.indexableSlugs.size).toBe(0);
    expect(selection.failedSlugs.size).toBe(0);
  });
});
