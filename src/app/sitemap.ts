import type { MetadataRoute } from "next";
import { getBrandSeoEntries } from "@/lib/services/brands";
import { getAllStories } from "@/lib/services/stories";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { buildBrandSitemapEntries } from "@/lib/seo/brand-sitemap";
import { buildDirectorySitemapSection } from "@/lib/seo/directory-sitemap";
import { getStockistDirectory } from "@/lib/services/stockists";
import { buildWhereToBuySitemapSection } from "@/lib/seo/where-to-buy-sitemap";
import { getAllTrails, type TrailEntry } from "@/lib/services/trails";
import { shouldIndexTrailHub } from "@/lib/seo/trail-hub-indexability";
import { routes } from "@/lib/routes";

export const revalidate = 3600;

const ALL_LOCALES: readonly Locale[] = ["zh-TW", "en"];

/**
 * `alternateLocales` defaults to the emitted set, which is right for every
 * surface whose "should we list it" and "which translations exist" answers are
 * the same question. Brands are the exception: DEV-1405 gates *membership* on
 * the raised promotion bar while hreflang still has to describe which
 * translations exist, and the brand detail page derives its own alternates from
 * the unchanged indexability bar. Narrowing `languages` to the promoted set
 * would put the sitemap and the page in direct disagreement.
 */
export function localizedEntries(
  path: string,
  availableLocales: readonly Locale[] = ALL_LOCALES,
  lastModified?: Date,
  alternateLocales: readonly Locale[] = availableLocales,
): MetadataRoute.Sitemap {
  return availableLocales.map((locale) => {
    const { canonical, languages } = buildAlternates(
      path,
      locale,
      alternateLocales,
    );
    return {
      url: canonical,
      ...(lastModified ? { lastModified } : {}),
      alternates: { languages },
    };
  });
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Published is the whole test. Trail quality is a precondition of publishing,
// enforced at authoring time, so the sitemap re-reads nothing to second-guess
// it: a curated-product query here could only ever remove a live URL from the
// index for a full revalidate window, and it would do it silently.
export function buildTrailSitemapEntries(
  trail: TrailEntry,
): MetadataRoute.Sitemap {
  return localizedEntries(
    routes.trail(trail.frontmatter.slug),
    ["zh-TW"],
    validDate(trail.frontmatter.updatedAt || trail.frontmatter.publishedAt),
  );
}

// zh-TW only, exactly like `/stories` above and like every trail below: /en/discover
// serves the same content and canonicals to the prefix-free twin, so submitting
// it would be a self-inflicted duplicate-content signal with non-reciprocal
// hreflang.
export function buildTrailHubSitemapEntries(): MetadataRoute.Sitemap {
  return localizedEntries(routes.discover(), ["zh-TW"]);
}

async function buildTrailSitemapSection(): Promise<MetadataRoute.Sitemap> {
  const result = await getAllTrails("zh-TW");
  // A failed read is not an empty slate: it drops the hub with its trails
  // rather than submitting a URL nothing here could vouch for.
  if (!result.ok) return [];
  // One read, one verdict. `shouldIndexTrailHub` is the hub page's own metadata
  // gate, reused rather than restated, so the sitemap can never submit a URL
  // that the page itself marks `noindex` — the two surfaces cannot drift.
  return [
    ...(shouldIndexTrailHub(result.trails) ? buildTrailHubSitemapEntries() : []),
    ...result.trails.flatMap((trail) => buildTrailSitemapEntries(trail)),
  ];
}

export function latestBrandDate(
  entries: ReadonlyArray<{ updatedAt: string }>,
): Date | undefined {
  const timestamps = entries
    .map((entry) => validDate(entry.updatedAt)?.getTime())
    .filter((value): value is number => value !== undefined);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages = [
    "/",
    routes.brands(),
    routes.categories(),
    routes.about(),
    routes.faq(),
    routes.contact(),
    routes.terms(),
    routes.privacy(),
    routes.submit.index(),
  ].flatMap((path) => localizedEntries(path));

  // Stories are zh-TW only. /en/stories and /en/stories/[slug] are reachable and now
  // serve that same zh-TW content rather than 404ing, which is exactly why they stay
  // OUT of the sitemap: the two URLs are byte-identical, so submitting both would put
  // duplicates in front of the crawler. Each /en story page canonicals to its
  // prefix-free zh-TW twin; the sitemap lists only that twin.
  const storyIndexPages = localizedEntries(routes.stories(), ["zh-TW"]);

  try {
    const rawBrandsPromise = getBrandSeoEntries();
    const brandsPromise = rawBrandsPromise.catch(() => []);
    const directoryPagesPromise = buildDirectorySitemapSection(rawBrandsPromise);
    const stockistPagesPromise = buildWhereToBuySitemapSection(getStockistDirectory());
    const trailPagesPromise = buildTrailSitemapSection().catch(() => []);
    const [brands, storyResult, categoryPages, stockistPages, trailPages] = await Promise.all([
      brandsPromise,
      getAllStories(),
      directoryPagesPromise,
      stockistPagesPromise,
      trailPagesPromise,
    ]);
    const stories = storyResult.ok ? storyResult.stories : [];

    const brandPages = buildBrandSitemapEntries(brands);

    const storyPages = stories.flatMap((story) => {
      if (story.frontmatter.locale === "en") return [];
      // zh-TW only, deliberately: the /en twin serves identical bytes and canonicals
      // here, so listing it would be a self-inflicted duplicate-content signal.
      const locale: Locale = "zh-TW";
      return localizedEntries(
        routes.story(story.frontmatter.slug),
        [locale],
        validDate(story.frontmatter.updatedAt || story.frontmatter.publishedAt),
      );
    });

    return [
      ...staticPages,
      ...storyIndexPages,
      ...categoryPages,
      ...stockistPages,
      ...brandPages,
      ...storyPages,
      ...trailPages,
    ];
  } catch {
    return [...staticPages, ...storyIndexPages];
  }
}
