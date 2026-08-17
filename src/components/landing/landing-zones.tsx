import Image from "next/image";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { EventCard } from "@/components/events/event-card";
import { ProductWall } from "@/components/landing/product-wall";
import { SectionHeader } from "@/components/shared/section-header";
import BrandShowcase from "@/components/shared/brand-showcase";
import { StoryRow } from "@/components/stories/story-row";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
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
  /**
   * EVERY indexable trail, not the ones the wall declined to place. A trail
   * that earns a wall tile still belongs in this zone: the tile is a picture in
   * a masonry grid, the row is the titled, dated route into `/discover`. The
   * zone used to read `wall.leftoverTrails`, which meant the single-trail case
   * — the trail is always placed — erased the zone from the page.
   */
  trails: TrailEntry[];
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
  trails,
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
              locale={locale}
              labels={{
                heading: t("selectedProducts.heading"),
                note: t("selectedProducts.note"),
                showMore: t("selectedProducts.showMore"),
                showLess: t("selectedProducts.showLess"),
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
          Every indexable trail — including the ones the wall placed as tiles.
          Duplication with the wall is deliberate and cheap: a wall tile is a
          photograph a reader may scroll past, and this row is the only titled,
          dated, keyboard-obvious path to `/discover`. Gating on
          `wall.leftoverTrails` instead cost the zone its whole existence the
          moment the site had one indexable trail, since that trail is always
          placed. The zone is withheld only when nothing is indexable — never
          because the wall is missing.

          This zone replaces the continuation strip that used to sit at the foot
          of the wall, where the same trails were a row of underlined links —
          the weakest presentation available for the editorial content they
          point at.

          It deliberately reuses the topics zone's construction: `SectionHeader`
          over a `StoryRow` list on the same divided rule. `StoryRow` already
          takes a `TrailEntry` (the /discover hub renders trails through it), so
          this is the existing component with `hrefBase` and `namespace`
          repointed, not a second row design to keep in sync.
        */}
        {trails.length > 0 ? (
          <section
            data-landing-zone="trails"
            aria-labelledby="landing-trails"
            className="py-6 md:py-8"
          >
            <div className="page-shell">
              <SectionHeader
                id="landing-trails"
                heading={t("trails.heading")}
                note={t("trails.note")}
                linkHref="/discover"
                linkLabel={t("trails.linkText")}
              />
              <div className="mt-8 divide-y divide-border border-y border-border">
                {trails.map((trail, index) => (
                  <StoryRow
                    key={trail.slug}
                    story={trail}
                    locale={locale}
                    headingLevel={3}
                    position={index}
                    trackingSurface="homepage_trails"
                    trackingKind="trail"
                    hrefBase="/discover"
                    namespace="discover"
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/*
          The manifesto band, restored 2026-08-17 from what production serves.
          It replaces the trust seam that the DEV-1479 recut put here.

          THE TRUST STATEMENT LEAVES THE HOMEPAGE WITH IT. The listings-vs-
          selections line is a public commitment in docs/strategy/brand-voice.md
          (`landing.trustSeam.line`), and it now
          ships only on /about and /faq — plus the `/og/trust` card, which was
          repointed at `landing.trustSeam.line` in the same change so it keeps
          stating the commitment even though no homepage section does. The
          `about` CTA below is the homepage's only remaining path to it.

          `sizes="100vw"` and no `priority`: this band is well below the fold,
          and the hero photograph above owns the preload.
        */}
        <section
          data-landing-zone="manifesto"
          aria-labelledby="landing-manifesto"
          className="relative overflow-hidden py-12 md:py-16"
        >
          <Image
            src="/images/manifesto-bg.webp"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
          {/* CONTRAST FLOOR — do not weaken either half of this.
              `manifesto-bg.webp` measures mean 128.8/255 greyscale with a 10th
              percentile of 53/255, so the darkest regions are what body text
              actually sits on. Over the previous `bg-background/70` scrim the
              muted foreground token composited to 3.83:1 on average and 3.04:1
              in those dark regions — under the 4.5:1 AA floor for body text.
              Two changes together clear it: the scrim goes to /85 (the paper
              background over p10 composites to ~223/255) and the body copy
              leaves the muted token for the full-strength foreground, landing at
              ~13:1 in the p10 region and ~14:1 on the mean. The headline was
              already `text-foreground` and gains the same margin. Anything below
              /85, or any return to `type-body-muted` here, re-breaks AA. */}
          <div className="absolute inset-0 bg-background/85" aria-hidden="true" />
          <div className="relative page-shell text-center">
            <h2
              id="landing-manifesto"
              className="mx-auto max-w-4xl type-page-title-large text-foreground"
            >
              {t("manifesto.headline")}
            </h2>
            <p className="mx-auto mt-3 max-w-3xl type-body">
              {t("manifesto.body1")}
            </p>
            <p className="mx-auto mt-3 max-w-3xl type-body">
              {t("manifesto.body2")}
            </p>
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

        {(events.length > 0 || stories.length > 0) && (
          <section
            data-landing-zone="topics"
            aria-labelledby="landing-topics"
            className="py-6 md:py-8"
          >
            <div className="page-shell">
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
            <div className="page-shell">
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
