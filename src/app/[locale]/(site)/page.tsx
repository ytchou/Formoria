import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import HeroSection from "@/components/landing/hero-section";
import { LandingZones } from "@/components/landing/landing-zones";
import SectionBand from "@/components/landing/section-band";
import { getExploreBrands } from "@/lib/services/brands";
import {
  getPublishedCuratedProductsForHomepage,
  getTrailPeekProducts,
  MIN_HOME_CURATED_PRODUCTS,
  trailPeekRequests,
} from "@/lib/services/curated-products";
import { buildGroupedWallSlots } from "@/lib/curated-products/home-wall";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { getAllStories } from "@/lib/services/stories";
import { getAllTrails } from "@/lib/services/trails";
import { toStoryCard } from "@/lib/stories/story-card";
import { toTrailCard, toTrailPeeks } from "@/lib/trails/trail-card";
import { toPublicBrandCard } from "@/lib/brands/contracts";

/** Stories shown in the topics zone before the reader is sent to `/stories`. */
const LANDING_STORY_LIMIT = 3;

export const revalidate = 3600;

/**
 * ANY failed read means this render is degraded, and a degraded render must
 * never be frozen by `revalidate = 3600`.
 *
 * Pure and exported so the exact set of inputs is asserted rather than
 * re-argued — a single build-time blip must not demote the site's most-visited
 * route to dynamic for the whole deployment, so which reads count is a fact a
 * test pins down, not a judgment each edit makes again. There are currently no
 * exclusions: every read this page performs is a parameter below.
 */
export function isLandingRenderDegraded({
  exploreResult,
  curatedProducts,
  stories,
  trails,
  trailPeeks,
}: {
  exploreResult: unknown;
  curatedProducts: unknown;
  stories: { ok: boolean };
  trails: { ok: boolean } | null;
  trailPeeks: unknown;
}): boolean {
  return (
    exploreResult === null ||
    curatedProducts === null ||
    !stories.ok ||
    trails === null ||
    !trails.ok ||
    trailPeeks === null
  );
}

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const t = await getTranslations("landing.metadata");
  const { canonical, languages } = buildAlternates("/", safeLocale);

  const ogLocale = safeLocale === "zh-TW" ? "zh_TW" : "en_US";
  const ogAlternateLocale = safeLocale === "zh-TW" ? "en_US" : "zh_TW";

  return {
    title: { absolute: t("title") },
    description: t("description"),
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title: t("title"),
      description: t("description"),
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  };
}

export default async function LandingPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const safeLocale = (locale === "en" ? "en" : "zh-TW") as Locale;
  const jsonLd = buildWebSiteJsonLd(safeLocale);
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);

  const trailRead = getAllTrails(safeLocale)
    .then((result) => {
      if (!result.ok) {
        captureReadFailure("landing.trails")(result.error);
      }
      return result;
    })
    .catch(captureReadFailure("landing.trails"));
  // Chained off the MDX read because it needs the slugs; it still runs inside
  // the same `Promise.all`, beside the other reads. A failed trails read
  // passes no slugs, which the service answers with `{}` and no query — that
  // failure is already counted as `trails`.
  const trailPeekRead = trailRead
    .then((result) =>
      getTrailPeekProducts(result?.ok ? trailPeekRequests(result.trails) : []),
    )
    .catch(captureReadFailure("landing.trailPeeks"));

  const [
    exploreResult,
    curatedProductsResult,
    storyResult,
    trailResult,
    trailPeeksResult,
  ] = await Promise.all([
    getExploreBrands().catch(captureReadFailure("landing.exploreBrands")),
    getPublishedCuratedProductsForHomepage().catch(
      captureReadFailure("landing.selectedProducts"),
    ),
    getAllStories(safeLocale),
    trailRead,
    trailPeekRead,
  ]);

  const degraded = isLandingRenderDegraded({
    exploreResult,
    curatedProducts: curatedProductsResult,
    stories: storyResult,
    trails: trailResult,
    trailPeeks: trailPeeksResult,
  });
  if (degraded) {
    await markRenderDegraded("landing");
  }

  const exploreBrands = (exploreResult?.brands ?? []).map(toPublicBrandCard);
  const totalBrandCount = exploreResult?.totalCount ?? 0;
  const latestStories = storyResult.ok
    ? storyResult.stories.slice(0, LANDING_STORY_LIMIT).map(toStoryCard)
    : [];
  const curatedProducts = curatedProductsResult ?? [];
  // Straight off the MDX read already in flight. Projected to card fields:
  // client-component props ship in the inline RSC payload (DEV-1972).
  const publishedTrails = trailResult?.ok
    ? trailResult.trails.map(toTrailCard)
    : [];
  const wallGroups = buildGroupedWallSlots({
    products: curatedProducts,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(organizationJsonLd),
        }}
      />
      <main>
        <LandingZones
          locale={safeLocale}
          hero={<HeroSection />}
          close={<SectionBand />}
          wall={
            curatedProducts.length >= MIN_HOME_CURATED_PRODUCTS
              ? { groups: wallGroups }
              : null
          }
          trails={publishedTrails}
          trailPeeks={toTrailPeeks(trailPeeksResult ?? {})}
          stories={latestStories}
          brands={exploreBrands}
          totalBrandCount={totalBrandCount}
        />
      </main>
    </>
  );
}
