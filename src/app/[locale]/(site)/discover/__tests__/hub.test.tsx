import { describe, expect, it } from "vitest";

import type { TrailEntry } from "@/lib/services/trails";
import { filterTrailsByTag, shouldIndexTrailHub } from "../page";

const trail = (slug: string, tags: string[]): TrailEntry => ({
  slug,
  frontmatter: {
    title: slug,
    description: "A trail",
    slug,
    tags,
    locale: "zh-TW",
    publishedAt: "2026-08-15T00:00:00.000Z",
    draft: false,
    sources: [],
    faq: [],
    sections: [],
    relatedCategories: [],
    relatedStories: [],
    relatedTrails: [],
  },
});

describe("discovery trail hub", () => {
  it("filters by a known tag and ignores an unknown tag", () => {
    const trails = [trail("home-trail", ["home"]), trail("craft-trail", ["crafts"])]

    expect(filterTrailsByTag(trails, "home").map((item) => item.slug)).toEqual([
      "home-trail",
    ]);
    expect(filterTrailsByTag(trails, "not-a-category")).toEqual(trails);
  });

  it("keeps the hub noindex until at least one trail clears the gate", () => {
    expect(shouldIndexTrailHub(new Set())).toBe(false);
    expect(shouldIndexTrailHub(new Set(["small-space-reading-corner"]))).toBe(true);
  });
});
