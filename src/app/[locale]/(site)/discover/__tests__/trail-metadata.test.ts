import { describe, expect, it } from "vitest";

import type { TrailEntry } from "@/lib/services/trails";
import { buildTrailMetadata } from "../[slug]/page";
import { buildTrailSitemapEntries } from "@/app/sitemap";
import { createStoryComponentMap } from "@/lib/mdx/components";

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
 * `thin` is the shape the render-time blocker gate used to withhold: a trail
 * carrying the bare minimum. Quality is a publish-time precondition now, so
 * neither surface may re-judge it — a published trail is a listed trail.
 */
const thin: TrailEntry = {
  ...trail,
  frontmatter: { ...trail.frontmatter, promise: undefined },
};

describe("discovery trail metadata", () => {
  it("emits no robots directive for any published trail", () => {
    for (const entry of [trail, thin]) {
      for (const locale of ["en", "zh-TW"]) {
        const metadata = buildTrailMetadata({ locale, trail: entry });

        expect(metadata.robots).toBeUndefined();
        // Absent, not merely undefined: `robots: undefined` would still be a
        // key Next has to interpret, and the gate it came from is gone.
        expect("robots" in metadata).toBe(false);
      }
    }
  });

  it("uses the prefix-free zh-TW canonical on both locales", () => {
    const [en, zh] = ["en", "zh-TW"].map((locale) =>
      buildTrailMetadata({ locale, trail }),
    );

    expect(en.alternates?.canonical).toMatch(
      /^https?:\/\/[^/]+\/discover\/small-space-reading-corner$/,
    );
    expect(zh.alternates?.canonical).toBe(en.alternates?.canonical);
  });

  it("includes every published trail in the sitemap", () => {
    // Curated-product supply is not an input here any more — the trail section
    // performs no product read at all, so an under-stocked trail can no longer
    // silently vanish from the sitemap for a whole revalidate window.
    for (const entry of [trail, thin]) {
      const entries = buildTrailSitemapEntries(entry);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.url).toMatch(
        /^https?:\/\/[^/]+\/discover\/small-space-reading-corner$/,
      );
    }
  });

  it("keeps the in-body FAQ block visual-only so the page emits one FAQPage", () => {
    const element = createStoryComponentMap().FaqBlock({
      questions: [{ q: "Question", a: "Answer" }],
    }) as { props?: { emitJsonLd?: boolean } };

    expect(element.props?.emitJsonLd).toBe(false);
  });
});
