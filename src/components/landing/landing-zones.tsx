import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { CuratedProductGrid } from "@/components/landing/curated-product-grid";
import { TrailTile } from "@/components/landing/trail-tile";
import { StoryCard } from "@/components/landing/story-card";
import BrandStrip from "@/components/landing/brand-strip";
import MissionCloser from "@/components/landing/mission-closer";
import { SectionHeader } from "@/components/shared/section-header";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { Grid, gridStyles } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import { displayBrandCount } from "@/lib/brands/display-brand-count";
import type { GroupedWallSlots } from "@/lib/curated-products/home-wall";
import type { Locale } from "@/lib/seo/alternates";
import type { CuratedProduct } from "@/lib/services/curated-products";
import type { StoryEntry } from "@/lib/services/stories";
import type { TrailEntry } from "@/lib/services/trails";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Trails the md-and-up grid shows; the snap row below md shows every trail. */
const DESKTOP_TRAIL_LIMIT = 3;

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
  wall: { groups: GroupedWallSlots } | null;
  /** Every indexable trail rendered in the dedicated editorial zone. */
  trails: TrailEntry[];
  /** Up to four placed products per trail slug, shown under each card. */
  trailPeeks: Record<string, CuratedProduct[]>;
  stories: StoryEntry[];
  brands: PublicBrandCard[];
  /** Directory-wide brand count, surfaced in BrandStrip and MissionCloser. */
  totalBrandCount: number;
};

/**
 * The homepage's zones, in order:
 *
 *     hero      the editorial opener — eyebrow, promise, lede, search
 *     selection the justified product wall
 *     directory one explore-style brand rail
 *     trails    the style zone — every indexable trail as an editorial card
 *     manifesto the photo band
 *     topics    stories
 *     close     the CTA band — recommend · newsletter
 *
 * Every zone carries `data-landing-zone`, which is the structure's contract: a
 * marker survives copy edits that a heading-text assertion would not.
 *
 * TWO ZONES THE APPROVED MOCK DOES NOT DRAW are kept, in the slot they already
 * held. `manifesto` is pinned on `/` by `e2e/tests/seo.spec.ts`, which asserts
 * its h2 is visible in both locales. `topics` renders stories and dropping it
 * would strip the stories read out of `page.tsx` and out of
 * `isLandingRenderDegraded`.
 *
 * Only ONE flat-color zone carries a background — the closing band, on
 * `surface`. The manifesto owns its photograph; every other seam is
 * whitespace, per DESIGN.md.
 */
export async function LandingZones({
  locale,
  hero,
  close,
  wall,
  trails,
  trailPeeks,
  stories,
  brands,
  totalBrandCount,
}: LandingZonesProps) {
  const t = await getTranslations({ locale, namespace: "landing" });
  const shownBrandCount = displayBrandCount(totalBrandCount);

  return (
    <>
      {/* The marker sits on a wrapper for the zones whose section element
          belongs to another component. */}
      <div data-landing-zone="hero">{hero}</div>

      <SavedBrandsProvider>
        {wall ? (
          <div data-landing-zone="selection">
            <CuratedProductGrid groups={wall.groups} locale={locale} />
          </div>
        ) : null}

        {brands.length > 0 && (
          <div data-landing-zone="directory" className="py-section">
            <PageShell measure="page">
              <BrandStrip
                brands={brands}
                totalCount={shownBrandCount}
              />
            </PageShell>
          </div>
        )}

        {/* The zone is withheld only when nothing is indexable. Its image-led
            cards are the homepage's single owner for discovery trails. */}
        {trails.length > 0 ? (
          <section
            data-landing-zone="trails"
            aria-labelledby="landing-trails"
            className="py-section"
          >
            <PageShell measure="page">
              <SectionHeader
                id="landing-trails"
                heading={t("trails.heading")}
                note={t("trails.note")}
                linkHref={routes.style()}
                linkLabel={t("trails.linkText")}
              />
              {/* ONE list serves both breakpoints, so each trail is one card
                  and one link in the DOM. Below md it is a native snap-scroll
                  row of every trail; from md up it becomes the three-up grid
                  and cards past the third leave the layout (and the tab
                  order) via `md:hidden`. The row's overflow would clip the
                  cards' 5px focus ring (2px ring + 3px offset), so below md
                  it carries 6px of padding inside a matching negative margin
                  and 6px less top margin, which keeps the 32px stack. */}
              <ul
                className={cn(
                  gridStyles({ cols: "triptych" }),
                  "-mx-1.5 mt-6.5 flex snap-x snap-mandatory overflow-x-auto p-1.5 md:mx-0 md:mt-8 md:grid md:snap-none md:overflow-visible md:p-0",
                )}
              >
                {trails.map((trail, index) => (
                  <TrailTile
                    key={trail.slug}
                    trail={trail}
                    position={index}
                    trailSurface="homepage_trails"
                    headingLevel="h3"
                    peek={trailPeeks[trail.slug]}
                    labels={{
                      eyebrow: t("trails.eyebrow"),
                      cta: t("trails.cta"),
                    }}
                    className={cn(
                      "shrink-0 basis-[85%] snap-start scroll-mx-1.5 md:basis-auto",
                      index >= DESKTOP_TRAIL_LIMIT && "md:hidden",
                    )}
                  />
                ))}
              </ul>
            </PageShell>
          </section>
        ) : null}

        {/* MissionCloser wraps its own PhotoBand and reads missionCloser.*
            keys internally. The trust statement (`trustSeam.line`) now ships
            only on /about, /faq, and the /og/trust card. */}
        <div data-landing-zone="manifesto">
          <MissionCloser brandCount={shownBrandCount} />
        </div>

        {stories.length > 0 && (
          <section
            data-landing-zone="topics"
            aria-labelledby="landing-topics"
            className="py-section"
          >
            <PageShell measure="page">
              <SectionHeader
                id="landing-topics"
                heading={t("latestStories.heading")}
                note={t("latestStories.note")}
                linkHref={routes.stories()}
                linkLabel={t("latestStories.linkText")}
              />
              <Grid as="ul" cols="triptych" className="mt-8">
                {stories.map((story, index) => (
                  <li key={story.slug}>
                    <StoryCard
                      story={story}
                      locale={locale}
                      position={index}
                      trackingSurface="homepage_latest_stories"
                    />
                  </li>
                ))}
              </Grid>
            </PageShell>
          </section>
        )}
      </SavedBrandsProvider>

      <div data-landing-zone="close">{close}</div>
    </>
  );
}
