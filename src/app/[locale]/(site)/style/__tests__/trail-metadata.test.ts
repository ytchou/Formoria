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

const sectionLabel = "主題選物";
// The `style.titleInChinese` en message, as next-intl would format it.
const titleInChinese = (title: string) => `${title} (in Chinese)`;

describe("style trail metadata", () => {
  it("titles the document with the trail, then the section name", () => {
    const metadata = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      sectionLabel,
      titleInChinese,
    });

    // The layout template appends "| Formoria"; share cards keep the bare title.
    expect(metadata.title).toBe(
      "A reading corner for a small room | 主題選物",
    );
    expect(metadata.openGraph?.title).toBe(trail.frontmatter.title);
  });

  it("marks a zh-TW trail's document title as Chinese on /en, and only there", () => {
    const en = buildTrailMetadata({
      locale: "en",
      trail,
      sectionLabel: "Guides",
      titleInChinese,
    });
    const zh = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      sectionLabel,
      titleInChinese,
    });

    expect(en.title).toBe(
      "A reading corner for a small room (in Chinese) | Guides",
    );
    expect(zh.title).toBe("A reading corner for a small room | 主題選物");
    // Share cards keep the bare title on both locales.
    expect(en.openGraph?.title).toBe(trail.frontmatter.title);
    expect(en.twitter).toBeUndefined();
  });

  it("emits no robots directive for a published trail, however sparse its frontmatter", () => {
    for (const entry of [trail, sparseFrontmatter]) {
      for (const locale of ["en", "zh-TW"]) {
        const metadata = buildTrailMetadata({
          locale,
          trail: entry,
          sectionLabel,
          titleInChinese,
        });

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
      sectionLabel,
      titleInChinese,
      productsReadFailed: true,
    });

    expect(readFailed.robots).toEqual({ index: false, follow: true });

    const readEmpty = buildTrailMetadata({
      locale: "zh-TW",
      trail,
      sectionLabel,
      titleInChinese,
      productsReadFailed: false,
    });

    expect("robots" in readEmpty).toBe(false);
  });

  it("uses the prefix-free zh-TW canonical on both locales", () => {
    const [en, zh] = ["en", "zh-TW"].map((locale) =>
      buildTrailMetadata({ locale, trail, sectionLabel, titleInChinese }),
    );

    expect(en.alternates?.canonical).toMatch(
      /^https?:\/\/[^/]+\/style\/small-space-reading-corner$/,
    );
    expect(zh.alternates?.canonical).toBe(en.alternates?.canonical);
  });

  it("publishes the hero as og:image and a twitter card", () => {
    const withHero: TrailEntry = {
      ...trail,
      frontmatter: {
        ...trail.frontmatter,
        heroImage: "/images/trails/x.webp",
        heroImageAlt: "A lamp beside a low chair",
      },
    };

    const metadata = buildTrailMetadata({
      locale: "zh-TW",
      trail: withHero,
      sectionLabel,
      titleInChinese,
    });

    expect(metadata.openGraph).toMatchObject({
      siteName: "Formoria",
      images: [
        { url: "/images/trails/x.webp", alt: "A lamp beside a low chair" },
      ],
    });
    expect(metadata.twitter).toEqual({
      title: trail.frontmatter.title,
      description: trail.frontmatter.description,
      images: "/images/trails/x.webp",
    });
  });

  it("falls back to the title as og:image alt", () => {
    const withHero: TrailEntry = {
      ...trail,
      frontmatter: { ...trail.frontmatter, heroImage: "/images/trails/x.webp" },
    };

    const metadata = buildTrailMetadata({
      locale: "en",
      trail: withHero,
      sectionLabel: "Guides",
    titleInChinese,
    });

    expect(metadata.openGraph).toMatchObject({
      images: [{ url: "/images/trails/x.webp", alt: trail.frontmatter.title }],
    });
  });

  it("emits no images and no twitter card without a hero", () => {
    const metadata = buildTrailMetadata({ locale: "zh-TW", trail, sectionLabel, titleInChinese });

    expect(metadata.openGraph).toMatchObject({ siteName: "Formoria" });
    expect("images" in (metadata.openGraph ?? {})).toBe(false);
    expect("twitter" in metadata).toBe(false);
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
