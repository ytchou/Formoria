import { Suspense } from "react";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { SearchInput } from "@/components/brands/search-input";
import { PhotoBand } from "@/components/ui/photo-band";
import { routes } from "@/lib/routes";

/**
 * THE EDITORIAL OPENER: TEXT FIRST, THEN THE FRAME.
 *
 * What opens the page is a point of view — eyebrow, promise, lede — with the
 * search field directly under it, and a photograph under that.
 *
 * 1. **The photograph is the BACKGROUND, not a frame in the flow.** The text
 *    sits on top of it behind a scrim — the same construction as the manifesto
 *    band in `landing-zones.tsx`, deliberately, because the page should not
 *    hold two different ideas of what a photographic band is. Every earlier
 *    round made the image a block of its own: above the text (2026-08-17,
 *    DEV-1544) or below it. Both read as a second picture competing with the
 *    wall of product photographs one viewport down. As a ground it states a
 *    register instead of claiming a slot.
 *
 *    THE SCRIM IS NOT TUNED HERE. `scrim="left"` names a contract in
 *    `@/lib/design/photo-band-scrims`, and
 *    `scripts/check-photo-band-contrast.ts` composites this photograph's real
 *    pixels under it on every `pnpm lint`. The band was flat `/85` for one
 *    afternoon, sized off the WHOLE frame when the copy occupies only the left
 *    60% — the bright plaster wall — so the shelves nobody reads over set the
 *    opacity and the photograph bleached to nothing. `--ink-muted` is the one
 *    role that still fails over this photograph (2.75:1 in the darkest 1% of
 *    the wide text zone), which is why the eyebrow and the browse prefix
 *    override their role's default ink below. That override is ENFORCED, not
 *    trusted: the gate reads the ink each node in here actually paints and
 *    checks those tokens, so deleting a `text-ink-soft` below fails the lint
 *    chain by name.
 *
 *    `preload` and `fetchPriority="high"`: this is the LCP element, so
 *    deferring it defers the metric. (`preload` is the prop; `priority` is the
 *    same behaviour under the name next 16 deprecated.) `landing-zones.tsx`
 *    and `selected-product-tile.tsx` both withhold it on the grounds that
 *    this photograph owns the page's single preload; if it is ever deleted
 *    again, both of those comments have to move with it.
 * 2. **No chip row.** All thirteen L1s moved into the persistent nav, which
 *    now renders them on `/` too. Keeping a copy here would put thirteen
 *    duplicate category links inside one viewport of the thirteen above.
 * 3. **No sentinel.** `[data-hero-sentinel]` existed for one reader — the
 *    header's IntersectionObserver, which revealed the nav search once the
 *    hero scrolled away. That search is unconditional now, so both sides go.
 *
 * The text is left-aligned, not centred: every zone below shares one reading
 * edge, and a centred opener is the one thing that breaks it.
 */

export default async function HeroSection() {
  const t = await getTranslations("landing.hero");

  /*
   * The photograph is written out as a literal rather than hoisted to a const:
   * `scripts/check-photo-band-contrast.ts` reads this prop from the source to
   * know which pixels to measure, and a band it cannot resolve fails the lint
   * chain rather than going unchecked.
   */
  return (
    <PhotoBand image="/images/home-hero.webp" alt="" scrim="left" preload>
      {/* WAS a 56rem cap of its own, held against the 100rem shell so the
          lede wrapped at a readable measure while the display line still ran
          long enough to read as a headline rather than as a stacked column of
          characters. That fourth width is no longer available: the page runs
          on three named measures, and the reading one is 48rem. The opener is
          8rem narrower now, and the EN headline stopped fitting on one line —
          but the remedy was balance, not width. `text-balance` on the h1 splits
          it into even lines instead of dropping a one-word orphan, so the
          display line stays bounded by prose-measure like every other node in
          here. Do not add a fourth measure for a wrap, and never re-inline an
          anonymous cap. */}
      <div className="prose-measure">
        {/* A `span`, not a `p`. DEV-1320 requires the positioning line to be
            the FIRST paragraph in the document — Google lifted a rotating brand
            blurb as the homepage snippet when it was not — and an eyebrow
            wrapped in `p` would take that position for six characters of
            category descriptor. */}
        {/* `text-ink-soft` overrides `type-eyebrow`'s muted ink: over the
            scrim the muted token measures 2.75:1 in this photograph's darkest
            regions, under the AA floor. */}
        <span className="block type-eyebrow text-ink-soft">{t("eyebrow")}</span>

        {/* The consumer promise, verbatim. `type-display` from `md` up; the
            page-title role below it, because 46px zh-TW characters overflow a
            390px viewport at this string's length. */}
        <h1 className="mt-4 type-page-title md:type-display text-balance">
          {t("headline")}
        </h1>

        {/* FIRST PROSE NODE, AND IT STAYS THAT WAY (DEV-1320). Google lifted a
            rotating brand blurb as the homepage snippet when it was not, and
            seo.spec.ts asserts this exact string is visible on `/`. The lede
            under it is the mock's editorial copy, which is longer and cannot
            take this position. */}
        <p className="mt-6 type-body text-ink-soft">{t("subheadline")}</p>
        <p className="mt-3 type-body text-ink-soft">{t("lede")}</p>

        {/* One control, one alternative. The field redirects to
            /brands?search=, which is the exact entry point the WebSite JSON-LD
            declares as its SearchAction. */}
        <div className="mt-8 flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          {/* SearchInput reads useSearchParams, which bails out of static
              prerendering unless it sits under a Suspense boundary. The
              fallback reserves the field's height so the opener does not
              shift. */}
          <Suspense
            fallback={<div className="h-11 w-full flex-1" aria-hidden="true" />}
          >
            <SearchInput
              redirectTo={routes.brands()}
              placeholder={t("searchPlaceholder")}
              formAriaLabel={t("searchLabel")}
              className="max-w-none flex-1"
            />
          </Suspense>

          {/* A `div`, not a `p`: `p` is reserved for prose here so the
              DEV-1320 guard above keeps counting only prose. */}
          <div className="flex items-center gap-3">
            {/* Same override, same reason, as the eyebrow above. */}
            <span className="type-metadata text-ink-soft">
              {t("browsePrefix")}
            </span>
            {/* /discover, NOT an in-page `#` anchor to the style zone. That zone
                is withheld when nothing is published, and a fragment pointing
                at an element that does not exist is a dead control that still
                looks live. */}
            <Link
              href={routes.discover()}
              className="inline-flex min-h-11 items-center gap-1 rounded-control type-nav text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
            >
              {t("browseCta")}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </PhotoBand>
  );
}
