import Image from 'next/image'
import { Suspense } from 'react'
import { Link } from '@/i18n/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import { SearchInput } from '@/components/brands/search-input'
import { buttonVariants } from '@/components/ui/button'
import { categoryLabel, L1_CATEGORIES } from '@/lib/taxonomy/ontology'

export default async function HeroSection() {
  const [t, locale] = await Promise.all([getTranslations('landing.hero'), getLocale()])
  // The hero is now the homepage's only category entry point (the header drops
  // its tab row on `/`), so it shows every L1 in the ontology's declared order
  // rather than a hand-picked subset — a curated seven silently became label
  // drift the moment the ontology was renamed.
  const categories = L1_CATEGORIES.map((category) => ({
    slug: category.slug,
    label: categoryLabel(category, locale),
  }))

  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      {/*
        Restored 2026-08-17 from what production still serves. The photograph
        was dropped in the DEV-1479 recut, which left the hero as plain text on
        paper above a wall of photographs.

        `priority`, and ONLY here. This is the LCP element, and it owns the
        page's single preload: the wall below it deliberately marks no tile
        `priority` at all, because two competing `fetchpriority=high` requests
        above the fold is the regression that pairing exists to prevent.

        WebP, not the original PNG. The source was a 1.78 MB PNG for a
        photograph — `next/image` re-encodes on request, but the optimizer cache
        sits on Railway's ephemeral disk (see next.config.ts), so every cold
        start decoded 1.78 MB in front of the page's LCP and the file shipped in
        the Docker image besides. Re-encoded at q90, it is 97 KB.

        The scrim is not decoration. `object-right` keeps the photograph's
        subject clear of the centred column, and the paper wash over it is what
        holds the prose at AA — measured against the darkest region of the
        image, not its average.

        CONTRAST FLOOR — do not weaken this, and do not reintroduce a per-
        breakpoint value. It used to thin from /80 to /70 at `md`, which made
        the scrim WEAKEST exactly where the hero is largest: the image's 10th
        percentile put the muted foreground token at ~4.19:1 there, under the
        4.5:1 AA floor. One value at /85 for every breakpoint, plus prose on the
        full-strength foreground token below, clears it with margin.
      */}
      <Image
        src="/images/hero-bg.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-right"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-background/85"
      />
      {/* `page-shell` is the landing page's one shared measure — the same
          declaration the product wall and every band below use, so the whole
          page lines up on a single left edge. `relative` lifts it over the
          photograph. Only the wrapper goes wide; the prose column inside keeps
          its own `max-w-5xl`. */}
      <div className="relative page-shell">
        {/* Centring is visual only — the DOM order below is the reading order,
            and everything after the control group returns to the page gutter. */}
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <h1 className="type-page-title md:type-display">{t('headline')}</h1>
          {/* Keeps the approved present positioning as the first prose in the DOM:
              otherwise the earliest body text is rotating brand-card copy, which Google
              was lifting as the homepage snippet (DEV-1320). Metadata carries the full
              mission separately. */}
          {/* `max-w-xl` (576px) is the plan's ~560px measure: zh-TW stays one
              line, and the longer EN line wraps to two — never the wide centred
              paragraph DESIGN.md forbids. */}
          {/* `text-foreground` overrides the muted colour `type-body`
              carries — see the contrast note on the scrim above. The type scale
              is unchanged; only the colour token moves. */}
          <p className="mt-3 max-w-xl type-body text-foreground">
            {t('subheadline')}
          </p>

          {/* One control, two intents: type a query, or accept the invitation to
              browse. The field redirects to /brands?search=, which is the exact
              entry point the WebSite JSON-LD declares as its SearchAction. */}
          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {/* SearchInput reads useSearchParams, which bails out of static
                prerendering unless it sits under a Suspense boundary. The fallback
                reserves the field's 48px height so the hero does not shift. */}
            <Suspense fallback={<div className="h-12 flex-1" aria-hidden="true" />}>
              <SearchInput
                redirectTo="/brands"
                placeholder={t('searchPlaceholder')}
                formAriaLabel={t('searchLabel')}
                className="max-w-none flex-1 text-start"
              />
            </Suspense>
            <Link
              href="/brands"
              data-ph-no-autocapture
              className={buttonVariants({
                variant: 'primary',
                className: 'shrink-0',
              })}
            >
              {t('browseCta')}
            </Link>
          </div>
        </div>

        {/* ONE row of twelve, measured rather than guessed: the zh-TW chips need
            1064px end to end (12 chips, 8px gaps), so the cap is the next round
            number above that. It deliberately overruns the 1024px search row
            above by ~96px — the alternative is a cap that fits the search axis
            and wraps every zh-TW chip block back to two lines, which is what the
            880px cap was doing with 180px to spare.

            EN is NOT one row: its labels are words, not four-character
            compounds, and the same twelve need 1714px. It wraps to two here and
            that is correct — forcing nowrap would overflow the viewport. Hence
            `flex-wrap`: one row where the labels fit, a clean second row where
            they do not, at every width from `md` up. */}
        <nav
          className="mx-auto mt-8 hidden w-full max-w-[1120px] flex-col gap-3 md:flex"
          aria-label={t('statsCategories')}
        >
          {/* 13px, so it is body text for AA purposes, not large text — the
              muted token in `type-metadata` does not clear 4.5:1 over the
              photograph. Same override as the subheadline. */}
          <p className="text-center type-metadata text-foreground">
            {t('categoriesEyebrow')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <HeroCategoryChips categories={categories} />
          </div>
        </nav>

        {/* Mobile keeps the single scrolling row: a 6x2 grid at this width
            either truncates the labels or eats the fold. */}
        <nav
          className="mt-8 flex min-w-0 gap-2 overflow-x-auto pb-1 md:hidden"
          aria-label={t('statsCategories')}
        >
          <HeroCategoryChips categories={categories} />
        </nav>
      </div>

      {/* The hero's bottom edge, published as an element so the sticky header
          can observe it. `main-nav.tsx` reveals its search field once this
          leaves the viewport, which is the only way that reveal can track a
          hero whose height moves with the copy, the locale (the twelve chips
          are one row in zh-TW and two in EN) and the font. A hardcoded pixel
          threshold stood here before and was coupled to none of them.
          Zero-height and `aria-hidden`, so it is invisible to layout and to
          assistive technology alike. */}
      <div
        data-hero-sentinel
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px"
      />
    </section>
  )
}
