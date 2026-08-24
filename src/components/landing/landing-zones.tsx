import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { ProductWall } from "@/components/landing/product-wall";
import { TrailTile } from "@/components/landing/trail-tile";
import { SectionHeader } from "@/components/shared/section-header";
import BrandShowcase from "@/components/shared/brand-showcase";
import { StoryRow } from "@/components/stories/story-row";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Grid } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import { PhotoBand } from "@/components/ui/photo-band";
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
}: LandingZonesProps) {
  const [t, tSelected] = await Promise.all([
    getTranslations({ locale, namespace: "landing" }),
    getTranslations({ locale, namespace: "brandDetail.selectedProducts" }),
  ]);

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
                // No trust-label opt-in. The wall renders `mode="wall"`, and
                // the tile gates the label on `mode === "outbound"` — so it
                // could never render from here. Opting in anyway made the
                // homepage look like it had asked for it.
                product: {
                  cta: tSelected("cta"),
                  brandSiteCta: tSelected("brandSiteCta"),
                  unavailable: tSelected("unavailable"),
                },
              }}
            />
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
              <Grid
                as="ul"
                cols={trails.length >= 3 ? "bands" : "single"}
                className="mt-8"
              >
                {trails.map((trail, index) => (
                  <TrailTile
                    key={trail.slug}
                    trail={trail}
                    labels={{
                      eyebrow: t("trails.eyebrow"),
                      cta: t("trails.cta"),
                    }}
                    position={index}
                    singleColumn={trails.length < 3}
                  />
                ))}
              </Grid>
            </PageShell>
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

          No `priority`: this band is well below the fold, and the photograph
          in the homepage opener owns the page's single preload. That claim was
          FALSE for the stretches when no such photograph existed at all, so if
          it is deleted again this comment and `selected-product-tile.tsx`'s
          copy of it both have to move with it, or one of the wall surfaces
          must take `priority` instead.

          The construction — image, scrim, copy on top — belongs to
          `PhotoBand`, which also owns the contrast floor this band used to
          argue for in twelve lines of its own. `manifesto-bg.webp` measured
          3.04:1 for body copy in its dark regions under the original `/70`
          scrim; that is now a `pnpm lint` failure rather than a comment.
        */}
        <PhotoBand
          data-landing-zone="manifesto"
          aria-labelledby="landing-manifesto"
          image="/images/manifesto-bg.webp"
          alt=""
          // FLAT, not `center`, and that is a deliberate hold rather than the
          // right answer. Centred copy wants a symmetric scrim — heavy through
          // the middle, thinner at both edges, so the shop's shelves come back
          // at the margins. This band was not the one anybody complained
          // about, so it keeps the uniform coverage it has shipped with while
          // the homepage opener moves first. Switching it to `center` is a
          // one-word change the contrast gate already checks.
          scrim="flat"
          contentClassName="text-center"
        >
          <h2
            id="landing-manifesto"
            className="mx-auto prose-measure type-page-title"
          >
            {t("manifesto.headline")}
          </h2>
          <p className="mx-auto mt-3 prose-measure type-body-sm text-ink-soft">
            {t("manifesto.body1")}
          </p>
          <p className="mx-auto mt-3 prose-measure type-body-sm text-ink-soft">
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
        </PhotoBand>

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
            </PageShell>
          </section>
        )}

        {brands.length > 0 && (
          <div data-landing-zone="directory" className="py-section">
            <PageShell measure="page">
              <BrandShowcase
                brands={brands}
                heading={t("showcase.heading")}
                subheading={t("showcase.subheading")}
                linkText={t("showcase.browseAll")}
                linkHref={routes.brands()}
                ctaLocation="homepage_explore"
              />
            </PageShell>
          </div>
        )}
      </SavedBrandsProvider>

      <div data-landing-zone="close">{close}</div>
    </>
  );
}
