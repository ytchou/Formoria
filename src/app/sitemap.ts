import type { MetadataRoute } from "next";
import { getBrandSeoEntries } from "@/lib/services/brands";
import { getPublishedEvents } from "@/lib/services/events";
import { getAllStories } from "@/lib/services/stories";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { buildAlternates, type Locale } from "@/lib/seo/alternates";
import { getBrandIndexability } from "@/lib/seo/brand-indexability";

export const revalidate = 3600;

const ALL_LOCALES: readonly Locale[] = ["zh-TW", "en"];

function localizedEntries(
  path: string,
  availableLocales: readonly Locale[] = ALL_LOCALES,
  lastModified?: Date,
): MetadataRoute.Sitemap {
  return availableLocales.map((locale) => {
    const { canonical, languages } = buildAlternates(
      path,
      locale,
      availableLocales,
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

function latestBrandDate(
  entries: Array<{ updatedAt: string }>,
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
    "/stats",
    "/about",
    "/glossary",
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
    const [brands, storyResult, events] = await Promise.all([
      getBrandSeoEntries(),
      getAllStories(),
      // Degrade to zero event entries instead of taking the sitemap down with
      // them: the events service throws on any query error, and an unguarded
      // rejection rejects the whole Promise.all even when brands and stories
      // already resolved — the catch below would then drop every /brands/<slug>,
      // every ?category= and every /stories/<slug> URL for the full revalidate
      // window. Same resilience as `storyResult.ok` on the next line.
      getPublishedEvents().catch(() => []),
    ]);
    const stories = storyResult.ok ? storyResult.stories : [];

    const brandPages = brands.flatMap((brand) => {
      const indexability = getBrandIndexability(brand);
      const availableLocales: Locale[] = [
        ...(indexability["zh-TW"] ? (["zh-TW"] as const) : []),
        ...(indexability.en ? (["en"] as const) : []),
      ];
      return localizedEntries(
        `/brands/${brand.slug}`,
        availableLocales,
        validDate(brand.updatedAt),
      );
    });

    const categoryPages = PRODUCT_TYPE_CATEGORIES.flatMap((category) => {
      const categoryBrands = brands.filter(
        (brand) => brand.productType === category.slug,
      );
      return localizedEntries(
        `/categories/${category.slug}`,
        ALL_LOCALES,
        latestBrandDate(categoryBrands),
      );
    });

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
      ...brandPages,
      ...storyPages,
      ...eventPages,
    ];
  } catch {
    return [...staticPages, ...storyIndexPages];
  }
}
