import { describe, expect, it } from "vitest";

import type { TrailEntry } from "@/lib/services/trails";
import { filterTrailsByTag, selectHubView, shouldIndexTrailHub } from "../page";

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

  it("keeps the hub noindex only when no trail is published", () => {
    expect(shouldIndexTrailHub([])).toBe(false);
    expect(shouldIndexTrailHub([trail("home-trail", ["home"])])).toBe(true);
  });

  it("lists every published trail", () => {
    const homeTrail = trail("home-trail", ["home"]);
    const craftTrail = trail("craft-trail", ["crafts"]);
    const trails = [homeTrail, craftTrail];

    // No supply filtering: publication is the only gate the hub applies.
    expect(
      selectHubView({ result: { ok: true, trails }, activeTag: null }),
    ).toEqual({ kind: "list", trails });

    // The tag filter is the only thing left that can narrow the list.
    expect(
      selectHubView({ result: { ok: true, trails }, activeTag: "home" }),
    ).toEqual({ kind: "list", trails: [homeTrail] });

    expect(
      selectHubView({ result: { ok: true, trails: [] }, activeTag: null }),
    ).toEqual({ kind: "comingSoon" });
  });

  it("surfaces a load error when the trail list read failed", () => {
    // The trail list is MDX on disk. It failing is a real outage, and the hub
    // says so rather than claiming there is nothing to read.
    expect(
      selectHubView({
        result: { ok: false, error: new Error("read failed") },
        activeTag: null,
      }),
    ).toEqual({ kind: "loadError" });
  });
});
