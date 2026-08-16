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

  it("keeps the hub noindex until at least one trail clears the gate", () => {
    expect(shouldIndexTrailHub(new Set())).toBe(false);
    expect(shouldIndexTrailHub(new Set(["small-space-reading-corner"]))).toBe(true);
  });

  it("an under-supplied trail is absent from the hub list", () => {
    const trails = [trail("home-trail", ["home"])];

    expect(
      selectHubView({
        result: { ok: true, trails },
        indexableSlugs: new Set(),
        failedSlugs: new Set(),
        activeTag: null,
      }),
    ).toEqual({ kind: "comingSoon" });
  });

  it("an indexable trail stays in the hub list", () => {
    const trails = [trail("home-trail", ["home"])];

    expect(
      selectHubView({
        result: { ok: true, trails },
        indexableSlugs: new Set(["home-trail"]),
        failedSlugs: new Set(),
        activeTag: null,
      }),
    ).toEqual({ kind: "list", trails });
  });

  it("surfaces a load error when the trail list read failed", () => {
    expect(
      selectHubView({
        result: { ok: false, error: new Error("read failed") },
        indexableSlugs: new Set(),
        failedSlugs: new Set(),
        activeTag: null,
      }),
    ).toEqual({ kind: "loadError" });
  });

  it("surfaces a load error when every supply read failed", () => {
    // The trail list is MDX on disk, so it still loads during a database
    // outage. Without this, the hub would claim there is no content.
    const trails = [trail("home-trail", ["home"]), trail("craft-trail", ["crafts"])];

    expect(
      selectHubView({
        result: { ok: true, trails },
        indexableSlugs: new Set(),
        failedSlugs: new Set(["home-trail", "craft-trail"]),
        activeTag: null,
      }),
    ).toEqual({ kind: "loadError" });
  });

  it("shows comingSoon when a tag matches only under-supplied trails", () => {
    const trails = [trail("home-trail", ["home"]), trail("craft-trail", ["crafts"])];

    expect(
      selectHubView({
        result: { ok: true, trails },
        indexableSlugs: new Set(["craft-trail"]),
        failedSlugs: new Set(),
        activeTag: "home",
      }),
    ).toEqual({ kind: "comingSoon" });
  });
});
