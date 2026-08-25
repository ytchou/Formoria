import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { CuratedProductGrid } from "@/components/landing/curated-product-grid";
import TrailCarousel from "@/components/landing/trail-carousel";
import { StoryCard } from "@/components/landing/story-card";
import BrandStrip from "@/components/landing/brand-strip";
import MissionCloser from "@/components/landing/mission-closer";
import { SectionHeader } from "@/components/shared/section-header";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { Grid } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { Locale } from "@/lib/seo/alternates";
import type { StoryEntry } from "@/lib/services/stories";
import type { TrailEntry } from "@/lib/services/trails";
import { routes } from "@/lib/routes";

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
  /** Every indexable trail rendered in the dedicated editorial zone. */
  trails: TrailEntry[];
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
 *     trails    the style zone — every indexable trail as an editorial card
 *     manifesto the photo band
 *     topics    stories
 *     directory one explore-style brand rail
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
  stories,
  brands,
  totalBrandCount,
}: LandingZonesProps) {
  const t = await getTranslations({ locale, namespace: "landing" });

  return (
    <>
      {/* The marker sits on a wrapper for the zones whose section element
          belongs to another component. */}
      <div data-landing-zone="hero">{hero}</div>

      <SavedBrandsProvider>
        {wall ? (
          <div data-landing-zone="selection">
            <CuratedProductGrid slots={wall.slots} locale={locale} />
          </div>
        ) : null}

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
                linkHref={routes.discover()}
                linkLabel={t("trails.linkText")}
              />
              <div className="mt-8">
                <TrailCarousel
                  trails={trails}
                  labels={{
                    eyebrow: t("trails.eyebrow"),
                    cta: t("trails.cta"),
                    prev: t("trails.prev"),
                    next: t("trails.next"),
                  }}
                />
              </div>
            </PageShell>
          </section>
        ) : null}

        {/* MissionCloser wraps its own PhotoBand and reads missionCloser.*
            keys internally. The trust statement (`trustSeam.line`) now ships
            only on /about, /faq, and the /og/trust card. */}
        <div data-landing-zone="manifesto">
          <MissionCloser brandCount={totalBrandCount} />
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

        {brands.length > 0 && (
          <div data-landing-zone="directory" className="py-section">
            <PageShell measure="page">
              <BrandStrip
                brands={brands}
                totalCount={totalBrandCount}
              />
            </PageShell>
          </div>
        )}
      </SavedBrandsProvider>

      <div data-landing-zone="close">{close}</div>
    </>
  );
}
