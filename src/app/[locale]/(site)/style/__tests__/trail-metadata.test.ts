import { describe, expect, it } from "vitest";

import type { TrailEntry } from "@/lib/services/trails";
import { buildTrailMetadata } from "../[slug]/page";
import {
  buildTrailHubSitemapEntries,
  buildTrailSitemapEntries,
} from "@/app/sitemap";


const trail: TrailEntry = {
  slug: "small-space-reading-corner",
  frontmatter: {
    title: "A reading corner for a small room",
    description: "A practical path from a narrow desk to a calmer corner.",
    slug: "small-space-reading-corner",
    tags: ["home"],
    locale: "zh-TW",
    publishedAt: "2026-08-15T00:00:00.000Z",
    draft: false,
    sources: ["https://example.com/editorial-source"],
    faq: [{ q: "What fits?", a: "A compact setup." }],
    promise: "Make one corner easier to use.",
    readerSituation: "You have very little floor space.",
    sections: [{ key: "desk", title: "At the desk" }],
    exclusions: "No renovation advice.",
    editorialOwner: "Formoria editorial",
    reviewedAt: "2026-08-15T00:00:00.000Z",
    relatedCategories: [],
    relatedStories: [],
    relatedTrails: [],
  },
};

/**
 * The shape the deleted render-time blocker gate used to withhold: a trail
 * carrying only the required frontmatter. It is kept to hold one specific line —
 * frontmatter completeness is no longer an input to metadata or to sitemap
 * membership. Quality is a publish-time precondition, so neither surface
 * re-judges it, and a published trail is a listed trail.
 */
const sparseFrontmatter: TrailEntry = {
  ...trail,
  frontmatter: { ...trail.frontmatter, promise: undefined },
};

describe("style trail metadata", () => {
  it("emits no robots directive for a published trail, however sparse its frontmatter", () => {
    for (const entry of [trail, sparseFrontmatter]) {
      for (const locale of ["en", "zh-TW"]) {
        const metadata = buildTrailMetadata({ locale, trail: entry });

        expect(metadata.robots).toBeUndefined();
        // Absent, not merely undefined: `robots: undefined` would still be a
        // key Next has to interpret, and the gate it came from is gone.
        expect("robots" in metadata).toBe(false);
      }
    }
  });

  it("noindexes a trail only when the curated-product read failed", () => {
    // Failure, not scarcity, and not the deleted supply floor: `null` products
    // mean the read threw, so the page renders zero tiles for a reason that has
    // nothing to do with the trail. A read that succeeds and returns nothing
    // stays indexable.
    const readFailed = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      productsReadFailed: true,
    });

    expect(readFailed.robots).toEqual({ index: false, follow: true });

    const readEmpty = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      productsReadFailed: false,
    });

    expect("robots" in readEmpty).toBe(false);
  });

  it("uses the prefix-free zh-TW canonical on both locales", () => {
    const [en, zh] = ["en", "zh-TW"].map((locale) =>
      buildTrailMetadata({ locale, trail }),
    );

    expect(en.alternates?.canonical).toMatch(
      /^https?:\/\/[^/]+\/style\/small-space-reading-corner$/,
    );
    expect(zh.alternates?.canonical).toBe(en.alternates?.canonical);
  });

  it("includes a published trail in the sitemap regardless of frontmatter completeness", () => {
    // Curated-product supply is not an input here any more — the trail section
    // performs no product read at all, so an under-stocked trail can no longer
    // silently vanish from the sitemap for a whole revalidate window.
    for (const entry of [trail, sparseFrontmatter]) {
      const entries = buildTrailSitemapEntries(entry);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.url).toMatch(
        /^https?:\/\/[^/]+\/style\/small-space-reading-corner$/,
      );
    }
  });

  it("lists the hub once, on the prefix-free zh-TW URL", () => {
    // /en/style serves the same content and canonicals to this URL, so
    // submitting it too would be a self-inflicted duplicate-content signal.
    const entries = buildTrailHubSitemapEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toMatch(/^https?:\/\/[^/]+\/style$/);
  });
});
