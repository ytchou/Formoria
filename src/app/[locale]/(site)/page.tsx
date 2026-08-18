import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import HeroSection from "@/components/landing/hero-section";
import {
  LandingZones,
  type PromotedEvent,
} from "@/components/landing/landing-zones";
import SectionBand from "@/components/landing/section-band";
import { EXPLORE_BRAND_LIMIT, getExploreBrands } from "@/lib/services/brands";
import {
  getPublishedCuratedProductsForHomepage,
  MIN_HOME_CURATED_PRODUCTS,
} from "@/lib/services/curated-products";
import { buildWallSlots } from "@/lib/curated-products/home-wall";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { getAllStories } from "@/lib/services/stories";
import { getIndexableTrailSlugs } from "@/lib/services/trail-supply";
import { getAllTrails } from "@/lib/services/trails";
import {
  getEventBrandCounts,
  getPublishedEvents,
  partitionEventsByPhase,
  resolveEventPhase,
  taipeiToday,
} from "@/lib/services/events";
import { toPublicBrandCard } from "@/lib/brands/contracts";

/**
 * Ongoing and upcoming events promoted on the landing page. Two, not the whole
 * hub: this is a pointer to `/events`, and a third card starts competing with
 * the brand showcase directly under it.
 */
const LANDING_EVENT_LIMIT = 2;

/** Stories shown in the topics zone before the reader is sent to `/stories`. */
const LANDING_STORY_LIMIT = 3;

export const revalidate = 3600;

/**
 * ANY failed read means this render is degraded, and a degraded render must
 * never be frozen by `revalidate = 3600`.
 *
 * `trailSupply` is deliberately NOT a parameter. Folding it in would let one
 * build-time blip demote the site's most-visited route to dynamic for the whole
 * deployment; a failed supply read hides the wall's trail tile instead. Pure and
 * exported so that exclusion is asserted rather than re-argued.
 */
export function isLandingRenderDegraded({
  exploreResult,
  curatedProducts,
  stories,
  trails,
  events,
  eventBrandCounts,
  promotedEventCount,
}: {
  exploreResult: unknown;
  curatedProducts: unknown;
  stories: { ok: boolean };
  trails: { ok: boolean } | null;
  events: unknown;
  eventBrandCounts: unknown;
  promotedEventCount: number;
}): boolean {
  return (
    exploreResult === null ||
    curatedProducts === null ||
    !stories.ok ||
    trails === null ||
    !trails.ok ||
    events === null ||
    (promotedEventCount > 0 && eventBrandCounts === null)
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

  const [
    exploreResult,
    curatedProductsResult,
    storyResult,
    trailResult,
    eventResult,
    trailSupply,
  ] = await Promise.all([
      getExploreBrands(EXPLORE_BRAND_LIMIT).catch(
        captureReadFailure("landing.exploreBrands"),
      ),
      getPublishedCuratedProductsForHomepage().catch(
        captureReadFailure("landing.selectedProducts"),
      ),
      getAllStories(safeLocale),
      getAllTrails(safeLocale)
        .then((result) => {
          if (!result.ok) {
            captureReadFailure("landing.trails")(result.error);
          }
          return result;
        })
        .catch(captureReadFailure("landing.trails")),
      getPublishedEvents().catch(captureReadFailure("landing.events")),
      // Supply gate for the wall's trail tile and the leftover-trail nav.
      // Batched here because it depends on nothing else in this render — kept
      // serial it put N curated-product round trips on the critical path.
      // The service reports its own read failures to Sentry internally (under
      // the scope passed here), so this `.catch` is belt-and-braces.
      getIndexableTrailSlugs(safeLocale, "landing.trailSupply").catch(
        captureReadFailure("landing.trailSupply"),
      ),
    ]);

  // One Taipei "today" for the whole render: partitioning on one value and
  // badging on another could put an event in the promoted row wearing a phase
  // pill from the other side of midnight. Same rule as the events hub.
  const today = taipeiToday();
  // Ongoing before upcoming, each already ascending by `startsOn` out of the
  // service — the concatenation is what the hub renders too, so the row and the
  // page it links to can never disagree about what comes first.
  const eventsByPhase = partitionEventsByPhase(eventResult ?? [], today);
  const liveEvents = [
    ...eventsByPhase.ongoing,
    ...eventsByPhase.upcoming,
  ].slice(0, LANDING_EVENT_LIMIT);
  // Counted only for what is actually rendered, so a hub-sized query never runs
  // for a row that shows at most two cards — and not at all when there are none.
  const eventBrandCounts =
    liveEvents.length > 0
      ? await getEventBrandCounts(liveEvents.map((event) => event.id)).catch(
          captureReadFailure("landing.events.brandCounts"),
        )
      : null;

  const degraded = isLandingRenderDegraded({
    exploreResult,
    curatedProducts: curatedProductsResult,
    stories: storyResult,
    trails: trailResult,
    events: eventResult,
    eventBrandCounts,
    promotedEventCount: liveEvents.length,
  });
  if (degraded) {
    await markRenderDegraded("landing");
  }

  const exploreBrands = (exploreResult?.brands ?? []).map(toPublicBrandCard);
  const latestStories = storyResult.ok
    ? storyResult.stories.slice(0, LANDING_STORY_LIMIT)
    : [];
  const curatedProducts = curatedProductsResult ?? [];
  // Deliberately kept OUT of the `degraded` aggregate above: folding it in would
  // let one build-time blip demote the site's most-visited route to dynamic for
  // the whole deployment. A failed read hides the trail tile instead.
  const indexableTrailSlugs = trailSupply?.indexableSlugs ?? new Set<string>();
  // One list, two consumers: the wall composes tiles from it and the trails
  // zone lists all of it. Computed once from reads already in flight — the zone
  // adds no query, so `/` stays statically rendered.
  const indexableTrails = (trailResult?.ok ? trailResult.trails : []).filter(
    (trail) => indexableTrailSlugs.has(trail.slug),
  );
  const wallSlots = buildWallSlots({
    products: curatedProducts,
    trails: indexableTrails,
  });
  const promotedEvents: PromotedEvent[] = liveEvents.map((event) => ({
    event,
    phase: resolveEventPhase(event, today),
    brandCount: eventBrandCounts?.get(event.id) ?? 0,
  }));

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
      {/* `data-page-measure="wide"` is read by a `:has()` rule in globals.css
          and raises `--page-measure` to the 100rem `page-shell` measure this
          page uses, so the footer below lines up with the wall rather than with
          the 80rem every other route caps at. Declarative on purpose: the
          footer stays a server component with no route check of its own. */}
      <main data-page-measure="wide">
        <LandingZones
          locale={safeLocale}
          hero={<HeroSection />}
          close={<SectionBand />}
          wall={
            curatedProducts.length >= MIN_HOME_CURATED_PRODUCTS
              ? { slots: wallSlots }
              : null
          }
          trails={indexableTrails}
          stories={latestStories}
          events={promotedEvents}
          brands={exploreBrands}
        />
      </main>
    </>
  );
}
