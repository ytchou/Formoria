import type { MetadataRoute } from "next";
import { getBrandSeoEntries } from "@/lib/services/brands";
import { getPublishedEvents } from "@/lib/services/events";
import { getAllStories } from "@/lib/services/stories";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { buildBrandSitemapEntries } from "@/lib/seo/brand-sitemap";
import { buildDirectorySitemapSection } from "@/lib/seo/directory-sitemap";
import { getStockistDirectory } from "@/lib/services/brand-channels";
import { buildWhereToBuySitemapSection } from "@/lib/seo/where-to-buy-sitemap";
import { trailIndexBlockers } from "@/lib/seo/trail-indexability";
import { getAllTrails, type TrailEntry } from "@/lib/services/trails";
import {
  getPublishedCuratedProductsForTrail,
  type TrailCuratedProduct,
} from "@/lib/services/curated-products";

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

export function buildTrailSitemapEntries(
  trail: TrailEntry,
  products: readonly TrailCuratedProduct[],
): MetadataRoute.Sitemap {
  if (trailIndexBlockers({ frontmatter: trail.frontmatter, products }).length > 0) return [];
  return localizedEntries(
    `/discover/${trail.frontmatter.slug}`,
    ["zh-TW"],
    validDate(trail.frontmatter.updatedAt || trail.frontmatter.publishedAt),
  );
}

async function buildTrailSitemapSection(): Promise<MetadataRoute.Sitemap> {
  const result = await getAllTrails("zh-TW");
  if (!result.ok) return [];

  const entries = await Promise.all(
    result.trails.map(async (trail) => {
      const products = await getPublishedCuratedProductsForTrail(trail.slug);
      return buildTrailSitemapEntries(trail, products);
    }),
  );
  return entries.flat();
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
    "/brands",
    // Deliberately in staticPages, not the try block: the hub is a real page with
    // zero events, and it must stay listed even when the dynamic block throws.
    "/events",
    "/about",
    "/faq",
    "/contact",
    "/terms",
    "/privacy",
    "/getting-started",
    "/submit",
  ].flatMap((path) => localizedEntries(path));

  // Stories are zh-TW only. /en/stories and /en/stories/[slug] are reachable and now
  // serve that same zh-TW content rather than 404ing, which is exactly why they stay
  // OUT of the sitemap: the two URLs are byte-identical, so submitting both would put
  // duplicates in front of the crawler. Each /en story page canonicals to its
  // prefix-free zh-TW twin; the sitemap lists only that twin.
  const storyIndexPages = localizedEntries("/stories", ["zh-TW"]);

  try {
    const rawBrandsPromise = getBrandSeoEntries();
    const brandsPromise = rawBrandsPromise.catch(() => []);
    const directoryPagesPromise = buildDirectorySitemapSection(rawBrandsPromise);
    const stockistPagesPromise = buildWhereToBuySitemapSection(getStockistDirectory());
    const trailPagesPromise = buildTrailSitemapSection().catch(() => []);
    const [brands, storyResult, events, categoryPages, stockistPages, trailPages] = await Promise.all([
      brandsPromise,
      getAllStories(),
      // Degrade to zero event entries instead of taking the sitemap down with
      // them: the events service throws on any query error, and an unguarded
      // rejection rejects the whole Promise.all even when brands and stories
      // already resolved — the catch below would then drop every /brands/<slug>,
      // every ?category= and every /stories/<slug> URL for the full revalidate
      // window. Same resilience as `storyResult.ok` on the next line.
      getPublishedEvents().catch(() => []),
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
        `/stories/${story.frontmatter.slug}`,
        [locale],
        validDate(story.frontmatter.updatedAt || story.frontmatter.publishedAt),
      );
    });

    // Unlike stories — whose /en twin serves byte-identical MDX and is therefore
    // kept out — an event with English copy is genuinely different content per
    // locale, so it is listed in both. Same per-locale gating as brands above:
    // an event without English copy lists zh-TW only.
    const eventPages = events.flatMap((event) =>
      localizedEntries(
        `/events/${event.slug}`,
        event.nameEn ? ALL_LOCALES : (["zh-TW"] as const),
        validDate(event.updatedAt),
      ),
    );

    return [
      ...staticPages,
      ...storyIndexPages,
      ...categoryPages,
      ...stockistPages,
      ...brandPages,
      ...storyPages,
      ...eventPages,
      ...trailPages,
    ];
  } catch {
    return [...staticPages, ...storyIndexPages];
  }
}
