import { readFileSync } from "node:fs";
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
  it("keeps the MDX product context behind a client boundary", () => {
    const source = readFileSync(
      "src/components/trails/trail-products.tsx",
      "utf8",
    );

    expect(source.startsWith("'use client'") || source.startsWith('"use client"')).toBe(
      true,
    );
  });

  it("captures discovery read failures before rendering the empty slate", () => {
    const detailSource = readFileSync(
      "src/app/[locale]/(site)/discover/[slug]/page.tsx",
      "utf8",
    );
    const hubSource = readFileSync(
      "src/app/[locale]/(site)/discover/page.tsx",
      "utf8",
    );

    expect(detailSource).toContain('captureReadFailure("discover.trail.products")');
    expect(detailSource).toContain('markRenderDegraded("discover.trail.products")');
    expect(hubSource).toContain("captureReadFailure");
    expect(hubSource).toContain('markRenderDegraded("discover.hub")');
  });

  it("tracks related story continuation links as story-card clicks", () => {
    const detailSource = readFileSync(
      "src/app/[locale]/(site)/discover/[slug]/page.tsx",
      "utf8",
    );

    expect(detailSource).toContain("RelatedStoryLink");
    expect(detailSource).toContain('storySurface="trail_related_stories"');
  });

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
      l1: "home",
      l2: [index % 2 === 0 ? "lighting" : "furniture"],
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

  it("keeps the in-body FAQ block visual-only so the page emits one FAQPage", () => {
    const element = createStoryComponentMap().FaqBlock({
      questions: [{ q: "Question", a: "Answer" }],
    }) as { props?: { emitJsonLd?: boolean } };

    expect(element.props?.emitJsonLd).toBe(false);
  });
});
