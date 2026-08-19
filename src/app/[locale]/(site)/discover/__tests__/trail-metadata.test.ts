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

describe("discovery trail metadata", () => {
  it("emits robots noindex when blockers exist", () => {
    const metadata = buildTrailMetadata({
      locale: "en",
      trail,
      blockers: ["min_products"],
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("emits no robots directive when blockers are empty", () => {
    const metadata = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      blockers: [],
    });

    expect(metadata.robots).toBeUndefined();
  });

  it("uses the prefix-free zh-TW canonical on both locales", () => {
    const [en, zh] = ["en", "zh-TW"].map((locale) =>
      buildTrailMetadata({ locale, trail, blockers: [] }),
    );

    expect(en.alternates?.canonical).toMatch(
      /^https?:\/\/[^/]+\/discover\/small-space-reading-corner$/,
    );
    expect(zh.alternates?.canonical).toBe(en.alternates?.canonical);
  });

  it("omits a blocked trail and includes a clear trail in the sitemap", () => {
    const sixProducts = Array.from({ length: 6 }, (_, index) => ({
      category: "home",
      subcategories: [index % 2 === 0 ? "lighting" : "furniture"],
      sectionKey: "desk",
    }));

    expect(buildTrailSitemapEntries(trail, sixProducts as never)).toHaveLength(1);
    expect(
      buildTrailSitemapEntries(
        { ...trail, frontmatter: { ...trail.frontmatter, promise: undefined } },
        sixProducts as never,
      ),
    ).toEqual([]);
  });

  // The supply gate lives in the page body, below `markRenderDegraded`. These
  // two guard the seams it must not move into: metadata has no degraded-render
  // protection, and the sitemap keeps its own read.
  it("blocked trail still produces noindex metadata", () => {
    const metadata = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      blockers: ["min_products"],
    });

    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toContain("/discover/small-space-reading-corner");
  });

  it("sitemap still omits a blocked trail", () => {
    expect(buildTrailSitemapEntries(trail, [] as never)).toEqual([]);
  });

  it("keeps the in-body FAQ block visual-only so the page emits one FAQPage", () => {
    const element = createStoryComponentMap().FaqBlock({
      questions: [{ q: "Question", a: "Answer" }],
    }) as { props?: { emitJsonLd?: boolean } };

    expect(element.props?.emitJsonLd).toBe(false);
  });
});
