import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { EventCard } from "@/components/events/event-card";
import { ProductWall } from "@/components/landing/product-wall";
import { SectionHeader } from "@/components/shared/section-header";
import BrandShowcase from "@/components/shared/brand-showcase";
import { StoryRow } from "@/components/stories/story-row";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { Link } from "@/i18n/navigation";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { Locale } from "@/lib/seo/alternates";
import type { Event, EventPhase } from "@/lib/services/events";
import type { StoryEntry } from "@/lib/services/stories";
import type { TrailEntry } from "@/lib/services/trails";

/** An event already resolved against the render's single Taipei "today". */
export type PromotedEvent = {
  event: Event;
  phase: EventPhase;
  brandCount: number;
};

export type LandingZonesProps = {
  locale: Locale;
  /**
   * The hero and the closing band arrive as elements rather than being
   * imported here: both are `async` server components that fetch their own
   * copy, and taking them as nodes keeps this composition renderable — and so
   * assertable — without the page's data reads.
   */
  hero: ReactNode;
  close: ReactNode;
  /** `null` when the wall is below its publication floor and must not render. */
  wall: { slots: WallSlot[]; leftoverTrails: TrailEntry[] } | null;
  stories: StoryEntry[];
  events: PromotedEvent[];
  brands: PublicBrandCard[];
};

/**
 * The homepage's six trust zones, in order:
 *
 *     hero      promise line, search, category chips
 *     selection the masonry wall with trails woven in
 *     seam      the listing-vs-selection line (`landing.manifesto.headline`) —
 *               thin, no photo band
 *     topics    stories, with a live event lifted above them
 *     directory one explore-style brand rail
 *     close     submit · feature request · newsletter, as one zone
 *
 * Every zone carries `data-landing-zone`, which is the structure's contract:
 * eight sections collapsing to six is the change this page exists to make, and
 * a marker survives copy edits that a heading-text assertion would not.
 *
 * Zones are separated by whitespace only — never by an alternating background,
 * per DESIGN.md.
 */
export async function LandingZones({
  locale,
  hero,
  close,
  wall,
  stories,
  events,
  brands,
}: LandingZonesProps) {
  const [t, tEvents, tSelected] = await Promise.all([
    getTranslations({ locale, namespace: "landing" }),
    getTranslations({ locale, namespace: "events" }),
    getTranslations({ locale, namespace: "brandDetail.selectedProducts" }),
  ]);

  const hasStories = stories.length > 0;

  return (
    <>
      {/* The marker sits on a wrapper for the zones whose section element
          belongs to another component. */}
      <div data-landing-zone="hero">{hero}</div>

      <SavedBrandsProvider>
        {wall ? (
          <div data-landing-zone="selection">
            <ProductWall
              slots={wall.slots}
              leftoverTrails={wall.leftoverTrails}
              locale={locale}
              labels={{
                heading: t("selectedProducts.heading"),
                note: t("selectedProducts.note"),
                showMore: t("selectedProducts.showMore"),
                showLess: t("selectedProducts.showLess"),
                continuationHeading: t("selectedProducts.continuationHeading"),
                trailLinksLabel: t("selectedProducts.trailLinksLabel"),
                categoryLinksLabel: t("selectedProducts.categoryLinksLabel"),
                brandsLink: t("selectedProducts.brandsLink"),
                product: {
                  cta: tSelected("cta"),
                  brandSiteCta: tSelected("brandSiteCta"),
                  selectedBadge: tSelected("selectedBadge"),
                  brandProvidedBadge: tSelected("brandProvidedBadge"),
                  unavailable: tSelected("unavailable"),
                },
                trail: {
                  eyebrow: t("selectedProducts.trailEyebrow"),
                  cta: t("selectedProducts.trailCta"),
                },
              }}
            />
          </div>
        ) : null}

        {/*
          The trust seam. It replaces the full-bleed manifesto band: the same
          commitment, set as one line between the selection wall and the
          directory rail, which is exactly where a reader needs to be told that
          listing and selection are different claims. No photograph — a photo band here
          reads as a third editorial zone competing with the two it separates.
        */}
        <section
          data-landing-zone="seam"
          aria-labelledby="landing-trust-seam"
          className="py-6 md:py-8"
        >
          <div className="mx-auto max-w-6xl page-gutter">
            <SectionHeader
              id="landing-trust-seam"
              heading={t("trustSeam.line")}
              note={t("trustSeam.note")}
              linkHref="/about"
              linkLabel={t("trustSeam.cta")}
            />
          </div>
        </section>

        {(events.length > 0 || stories.length > 0) && (
          <section
            data-landing-zone="topics"
            aria-labelledby="landing-topics"
            className="py-6 md:py-8"
          >
            <div className="mx-auto max-w-6xl page-gutter">
              {/* The zone renders whenever it has events OR stories, so its
                  heading, note and link follow what it actually contains — an
                  events-only zone headed "Stories", linking to /stories, would
                  also name the landmark "Stories" for a list of events. */}
              <SectionHeader
                id="landing-topics"
                heading={
                  hasStories ? t("latestStories.heading") : t("events.heading")
                }
                note={hasStories ? t("latestStories.note") : undefined}
                linkHref={hasStories ? "/stories" : "/events"}
                linkLabel={
                  hasStories
                    ? t("latestStories.linkText")
                    : t("events.linkText")
                }
              />

              {/*
                A live event lifts above the stories: it is the only item on
                this page a reader can act on with a date attached, and it
                stops being true on a known day. The list keeps the events
                heading as its accessible name rather than a visible `h3`, so
                the cards stay one level under the zone's `h2`.
              */}
              {events.length > 0 && (
                <div className="mt-6 space-y-4">
                  <ul
                    aria-label={t("events.heading")}
                    className="flex list-none flex-col gap-4 p-0"
                  >
                    {events.map(({ event, phase, brandCount }) => (
                      <li key={event.id}>
                        <EventCard
                          event={event}
                          phase={phase}
                          phaseLabel={tEvents(`phase.${phase}`)}
                          brandCountLabel={
                            brandCount > 0
                              ? tEvents("brandCount", { count: brandCount })
                              : null
                          }
                          locale={locale}
                          headingLevel={3}
                        />
                      </li>
                    ))}
                  </ul>
                  {/* Only when the zone header points at /stories — otherwise
                      the header already carries this exact link. */}
                  {hasStories && (
                    <Link
                      href="/events"
                      className="inline-flex min-h-12 items-center font-medium text-primary"
                    >
                      {t("events.linkText")}
                    </Link>
                  )}
                </div>
              )}

              {stories.length > 0 && (
                <div className="mt-8 divide-y divide-border border-y border-border">
                  {stories.map((story, index) => (
                    <StoryRow
                      key={story.slug}
                      story={story}
                      locale={locale}
                      headingLevel={3}
                      position={index}
                      trackingSurface="homepage_latest_stories"
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {brands.length > 0 && (
          <div data-landing-zone="directory" className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <BrandShowcase
                brands={brands}
                heading={t("showcase.heading")}
                subheading={t("showcase.subheading")}
                linkText={t("showcase.browseAll")}
                linkHref="/brands"
                ctaLocation="homepage_explore"
              />
            </div>
          </div>
        )}
      </SavedBrandsProvider>

      <div data-landing-zone="close">{close}</div>
    </>
  );
}

export default LandingZones;
