import { SurfaceImage } from "@/components/ui/image";
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
import { Grid } from "@/components/ui/grid";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { Locale } from "@/lib/seo/alternates";
import type { Event, EventPhase } from "@/lib/services/events";
import type { StoryEntry } from "@/lib/services/stories";
import type { TrailEntry } from "@/lib/services/trails";
import { routes } from "@/lib/routes";

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
  wall: { slots: WallSlot[] } | null;
  /**
   * EVERY indexable trail, not the ones the wall declined to place. A trail
   * that earns a wall tile still belongs in this zone: the tile is a picture in
   * a masonry grid, the row is the titled, dated route into `/discover`. The
   * zone used to read the wall's leftover trails, which meant the single-trail
   * case — the trail is always placed — erased the zone from the page.
   */
  trails: TrailEntry[];
  stories: StoryEntry[];
  events: PromotedEvent[];
  brands: PublicBrandCard[];
};

/**
 * The homepage's zones, in order:
 *
 *     hero      the editorial opener — eyebrow, promise, lede, search
 *     selection the justified wall with trails woven in
 *     trust     the trust-seam line — membership and selection, kept clearly
 *               apart — explained as prose in three columns
 *     trails    the style zone — every indexable trail as a titled row
 *     manifesto the photo band
 *     topics    stories, with a live event lifted above them
 *     directory one explore-style brand rail
 *     close     the CTA band — recommend · feature request · newsletter
 *
 * Every zone carries `data-landing-zone`, which is the structure's contract: a
 * marker survives copy edits that a heading-text assertion would not.
 *
 * TWO ZONES THE APPROVED MOCK DOES NOT DRAW are kept, in the slot they already
 * held. `manifesto` is pinned on `/` by `e2e/tests/seo.spec.ts`, which asserts
 * its h2 is visible in both locales. `topics` is the homepage's only path to a
 * dated event, and dropping it would also strip the stories and events reads
 * out of `page.tsx` and out of `isLandingRenderDegraded`.
 *
 * Only ONE zone carries a background — the trust band, on `surface`. Every
 * other seam is whitespace, per DESIGN.md.
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
                // No `selectedBadge`. The wall renders `mode="wall"`, and the
                // tile gates the trust label on `mode === "outbound"` — so the
                // label could never render from here. Passing it anyway made
                // the homepage look like it had opted in.
                product: {
                  cta: tSelected("cta"),
                  brandSiteCta: tSelected("brandSiteCta"),
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
          THE TRUST IA AS PROSE, NEVER AS BADGES (D11).

          The homepage states what directory membership, the selection label
          and the brand-supplied credit each mean, in running text, once. It
          renders no trust BADGE at all — the single rendered selection badge
          lives on brand detail, and a badge here would read as the homepage
          certifying something.

          The heading is `landing.trustSeam.line`, the commitment in
          docs/strategy/brand-voice.md. It left the homepage on 2026-08-17 when
          the manifesto band replaced the thin seam; this band brings it back
          with the explanation the thin seam never had.

          Column titles are h3, not h2: `homepage-curated-product.spec.ts` finds
          the wall by the section whose h2 reads exactly the selection label
          (`landing.selectedProducts.heading`), and the trust column's title is
          that same string — a second h2 with it would give the selector two
          matches.
        */}
        <section
          data-landing-zone="trust"
          aria-labelledby="landing-trust"
          className="bg-surface py-section"
        >
          <div className="page-shell flex flex-col gap-stack lg:flex-row lg:gap-gutter">
            <div className="lg:w-1/4">
              <h2 id="landing-trust" className="type-section">
                {t("trustSeam.line")}
              </h2>
              <p className="mt-3 type-body-sm">{t("trust.note")}</p>
            </div>
            {/* The shared grid primitive, not a local `md:grid-cols-3`. */}
            <Grid cols="triptych" gap="gutter" className="lg:flex-1">
              {(
                [
                  ["listed", t("trust.listedTitle"), t("trust.listedBody")],
                  ["selected", t("trust.selectedTitle"), t("trust.selectedBody")],
                  ["supplied", t("trust.suppliedTitle"), t("trust.suppliedBody")],
                ] as const
              ).map(([key, title, body]) => (
                // Elevation is a border, never a shadow: the rule over each
                // column is the whole separation between them.
                <div key={key} className="border-t-2 border-ink pt-4">
                  <h3 className="type-label">{title}</h3>
                  <p className="mt-3 type-body-sm">{body}</p>
                </div>
              ))}
            </Grid>
          </div>
        </section>

        {/*
          Every indexable trail — including the ones the wall placed as tiles.
          Duplication with the wall is deliberate and cheap: a wall tile is a
          photograph a reader may scroll past, and this row is the only titled,
          dated, keyboard-obvious path to `/discover`. Gating on the trails the
          wall left over instead cost the zone its whole existence the moment
          the site had one indexable trail, since that trail is always placed.
          The zone is withheld only when nothing is indexable — never
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
            className="py-section"
          >
            <div className="page-shell">
              <SectionHeader
                id="landing-trails"
                heading={t("trails.heading")}
                note={t("trails.note")}
                linkHref={routes.discover()}
                linkLabel={t("trails.linkText")}
              />
              <div className="mt-8 divide-y divide-rule border-y border-rule">
                {trails.map((trail, index) => (
                  <StoryRow
                    key={trail.slug}
                    story={trail}
                    locale={locale}
                    headingLevel={3}
                    position={index}
                    trackingSurface="homepage_trails"
                    trackingKind="trail"
                    hrefBase={routes.discover()}
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

          `surface="hero"` (100vw) and no `priority`: this band is well below
          the fold, and the hero photograph above owns the preload.
        */}
        <section
          data-landing-zone="manifesto"
          aria-labelledby="landing-manifesto"
          className="relative overflow-hidden py-section"
        >
          <SurfaceImage
            src="/images/manifesto-bg.webp"
            alt=""
            fill
            surface="hero"
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
              ~13:1 in the p10 region and ~14:1 on the mean. The headline carries
              `type-page-title`, whose default ink is the full-strength token, so
              it has the same margin. Anything below /85 re-breaks AA. */}
          <div className="absolute inset-0 bg-ground/85" aria-hidden="true" />
          <div className="relative page-shell text-center">
            <h2
              id="landing-manifesto"
              className="mx-auto max-w-4xl type-page-title"
            >
              {t("manifesto.headline")}
            </h2>
            <p className="mx-auto mt-3 max-w-3xl type-body-sm text-ink-soft">
              {t("manifesto.body1")}
            </p>
            <p className="mx-auto mt-3 max-w-3xl type-body-sm text-ink-soft">
              {t("manifesto.body2")}
            </p>
            <Link
              href={routes.about()}
              className={buttonVariants({
                variant: "primary",
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
            className="py-section"
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
                linkHref={hasStories ? routes.stories() : routes.events()}
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
                      href={routes.events()}
                      className="inline-flex min-h-12 items-center font-medium text-accent"
                    >
                      {t("events.linkText")}
                    </Link>
                  )}
                </div>
              )}

              {stories.length > 0 && (
                <div className="mt-8 divide-y divide-rule border-y border-rule">
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
          <div data-landing-zone="directory" className="py-section">
            <div className="page-shell">
              <BrandShowcase
                brands={brands}
                heading={t("showcase.heading")}
                subheading={t("showcase.subheading")}
                linkText={t("showcase.browseAll")}
                linkHref={routes.brands()}
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
