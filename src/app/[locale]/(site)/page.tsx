import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import HeroSection from "@/components/landing/hero-section";
import { ProductWall } from "@/components/landing/product-wall";
import { HeroStats } from "@/components/landing/hero-stats";
import BrandShowcase from "@/components/shared/brand-showcase";
import SectionBand from "@/components/landing/section-band";
import {
  EXPLORE_BRAND_LIMIT,
  getExploreBrands,
  getNewBrands,
} from "@/lib/services/brands";
import {
  getPublishedCuratedProductsForHomepage,
  MIN_HOME_CURATED_PRODUCTS,
} from "@/lib/services/curated-products";
import { buildWallSlots } from "@/lib/curated-products/home-wall";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { captureReadFailure, markRenderDegraded } from "@/lib/degraded-render";
import { buildAlternates } from "@/lib/seo/alternates";
import type { Locale } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { getAllStories } from "@/lib/services/stories";
import { getIndexableTrailSlugs } from "@/lib/services/trail-supply";
import { getAllTrails } from "@/lib/services/trails";
import { StoryRow } from "@/components/stories/story-row";
import { EventCard } from "@/components/events/event-card";
import {
  getEventBrandCounts,
  getPublishedEvents,
  partitionEventsByPhase,
  resolveEventPhase,
  taipeiToday,
} from "@/lib/services/events";
import { toPublicBrandCard } from "@/lib/brands/contracts";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";

/**
 * Ongoing and upcoming events promoted on the landing page. Two, not the whole
 * hub: this is a pointer to `/events`, and a third card starts competing with
 * the brand showcase directly under it.
 */
const LANDING_EVENT_LIMIT = 2;

export const revalidate = 3600;

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
  const [t, tEvents, tSelected] = await Promise.all([
    getTranslations("landing"),
    getTranslations("events"),
    getTranslations({ locale: safeLocale, namespace: "brandDetail.selectedProducts" }),
  ]);
  const jsonLd = buildWebSiteJsonLd(safeLocale);
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale);

  const [
    exploreResult,
    newBrandsResult,
    curatedProductsResult,
    storyResult,
    trailResult,
    eventResult,
    trailSupply,
  ] = await Promise.all([
      getExploreBrands(EXPLORE_BRAND_LIMIT).catch(
        captureReadFailure("landing.exploreBrands"),
      ),
      getNewBrands(4).catch(captureReadFailure("landing.newBrands")),
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
  const promotedEvents = [
    ...eventsByPhase.ongoing,
    ...eventsByPhase.upcoming,
  ].slice(0, LANDING_EVENT_LIMIT);
  // Counted only for what is actually rendered, so a hub-sized query never runs
  // for a row that shows at most two cards — and not at all when there are none.
  const eventBrandCounts =
    promotedEvents.length > 0
      ? await getEventBrandCounts(
          promotedEvents.map((event) => event.id),
        ).catch(captureReadFailure("landing.events.brandCounts"))
      : null;

  // Aggregate flag: ANY failed read means this render is degraded, and a degraded
  // render must never be frozen by `revalidate = 3600`.
  const degraded =
    exploreResult === null ||
    newBrandsResult === null ||
    curatedProductsResult === null ||
    !storyResult.ok ||
    trailResult === null ||
    !trailResult.ok ||
    eventResult === null ||
    (promotedEvents.length > 0 && eventBrandCounts === null);
  if (degraded) {
    await markRenderDegraded("landing");
  }

  const exploreBrands = (exploreResult?.brands ?? []).map(toPublicBrandCard);
  const newBrands = (newBrandsResult ?? []).map(toPublicBrandCard);
  // Suppressed per read, not per page: a failed `getNewBrands` must not hide a
  // total count that `getExploreBrands` returned successfully. `undefined` omits
  // the figure rather than asserting a false zero; a genuinely empty DB still
  // resolves `totalCount: 0` and renders 0.
  const totalBrandCount = exploreResult?.totalCount;
  const latestStories = storyResult.ok ? storyResult.stories.slice(0, 3) : [];
  const curatedProducts = curatedProductsResult ?? [];
  // Deliberately kept OUT of the `degraded` aggregate above: folding it in would
  // let one build-time blip demote the site's most-visited route to dynamic for
  // the whole deployment. A failed read hides the trail tile instead.
  const indexableTrailSlugs = trailSupply?.indexableSlugs ?? new Set<string>();
  const wall = buildWallSlots({
    products: curatedProducts,
    trails: (trailResult?.ok ? trailResult.trails : []).filter((trail) =>
      indexableTrailSlugs.has(trail.slug),
    ),
  });
  const selectedProductLabels: SelectedProductTileLabels = {
    cta: tSelected("cta"),
    brandSiteCta: tSelected("brandSiteCta"),
    selectedBadge: tSelected("selectedBadge"),
    brandProvidedBadge: tSelected("brandProvidedBadge"),
    unavailable: tSelected("unavailable"),
  };

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
        <HeroSection />

        <SavedBrandsProvider>
          {curatedProducts.length >= MIN_HOME_CURATED_PRODUCTS && (
            <ProductWall
              slots={wall.slots}
              leftoverTrails={wall.leftoverTrails}
              locale={safeLocale}
              labels={{
                heading: t("selectedProducts.heading"),
                note: t("selectedProducts.note"),
                showMore: t("selectedProducts.showMore"),
                continuationHeading: t("selectedProducts.continuationHeading"),
                trailLinksLabel: t("selectedProducts.trailLinksLabel"),
                categoryLinksLabel: t("selectedProducts.categoryLinksLabel"),
                brandsLink: t("selectedProducts.brandsLink"),
                product: selectedProductLabels,
                trail: {
                  eyebrow: t("selectedProducts.trailEyebrow"),
                  cta: t("selectedProducts.trailCta"),
                },
              }}
            />
          )}

          {latestStories.length > 0 && (
            <div className="py-6 md:py-8">
              <section className="mx-auto max-w-6xl page-gutter">
                <div className="mb-6">
                  <h2 className="type-page-title-large">
                    {t("latestStories.heading")}
                  </h2>
                </div>
                <div className="divide-y divide-border border-y border-border">
                  {latestStories.map((story, index) => (
                    <StoryRow
                      key={story.slug}
                      story={story}
                      locale={safeLocale}
                      headingLevel={3}
                      position={index}
                      trackingSurface="homepage_latest_stories"
                    />
                  ))}
                </div>
                <div className="mt-6">
                  <Link href="/stories" className="font-medium text-primary">
                    {t("latestStories.linkText")}
                  </Link>
                </div>
              </section>
            </div>
          )}

          {promotedEvents.length > 0 && (
            <div className="py-6 md:py-8">
              <section
                aria-labelledby="landing-events"
                className="mx-auto max-w-6xl page-gutter space-y-4"
              >
                <h2 id="landing-events" className="type-page-title-large">
                  {t("events.heading")}
                </h2>
                <div className="flex flex-col gap-4">
                  {promotedEvents.map((event) => {
                    const count = eventBrandCounts?.get(event.id) ?? 0;
                    const phase = resolveEventPhase(event, today);

                    return (
                      <EventCard
                        key={event.id}
                        event={event}
                        phase={phase}
                        phaseLabel={tEvents(`phase.${phase}`)}
                        brandCountLabel={
                          count > 0 ? tEvents("brandCount", { count }) : null
                        }
                        locale={locale}
                        headingLevel={3}
                      />
                    );
                  })}
                </div>
                <div>
                  <Link href="/events" className="font-medium text-primary">
                    {t("events.linkText")}
                  </Link>
                </div>
              </section>
            </div>
          )}

          <section className="relative overflow-hidden py-12 md:py-16">
            <Image
              src="/images/manifesto-bg.webp"
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div
              className="absolute inset-0 bg-background/70"
              aria-hidden="true"
            />
            <div className="relative mx-auto max-w-4xl page-gutter text-center">
              <blockquote className="type-page-title-large text-foreground">
                {t("manifesto.headline")}
              </blockquote>
              <p className="mt-3 type-body-muted">{t("manifesto.body1")}</p>
              <p className="mt-3 type-body-muted">{t("manifesto.body2")}</p>
              <Link
                href="/about"
                className={buttonVariants({
                  variant: "primary",
                  tone: "cta",
                  className: "mt-4",
                })}
              >
                {t("manifesto.cta")}
              </Link>
            </div>
          </section>

          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <HeroStats
                brandCount={totalBrandCount}
                brandLabel={t("hero.statsBrands")}
                categoryCount={PRODUCT_TYPE_CATEGORIES.length}
                categoryLabel={t("hero.statsCategories")}
              />
              <div className="mt-6">
                <BrandShowcase
                  brands={exploreBrands}
                  heading={t("showcase.heading")}
                  subheading={t("showcase.subheading")}
                  linkText={t("showcase.browseAll")}
                  linkHref="/brands"
                  ctaLocation="homepage_explore"
                />
              </div>
            </div>
          </div>

          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <BrandShowcase
                brands={newBrands}
                heading={t("newBrands.heading")}
                linkText={t("newBrands.linkText")}
                linkHref="/brands"
                ctaLocation="homepage_new_brands"
              />
            </div>
          </div>
        </SavedBrandsProvider>

        <SectionBand />
      </main>
    </>
  );
}
