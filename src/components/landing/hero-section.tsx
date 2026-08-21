import { Suspense } from 'react'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { SearchInput } from '@/components/brands/search-input'
import { EditorialHero } from '@/components/ui/editorial-hero'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'

/**
 * The path of the originated lead frame. A repo path, not a remote URL:
 * `safeImageSrc` rejects every relative path, and `editorialHeroSrc` inside
 * `EditorialHero` takes the `startsWith('/')` branch for exactly this case.
 */
const HERO_IMAGE = '/images/home-hero.webp'

/**
 * THE EDITORIAL OPENER, WITH A LEAD FRAME.
 *
 * The product wall stops being the first screen. What opens the page is a
 * photograph and a point of view — lead frame, eyebrow, promise, lede — with
 * the search field directly under them.
 *
 * 1. **The photograph came back (DEV-1544).** It reverses D2 of the 2026-08-16
 *    landing redesign ("hero airy, no photograph"), which was itself the fifth
 *    move in a week. D2's argument was real and is answered, not ignored: the
 *    old hero was a *scrimmed* image sitting one viewport above a sheet of
 *    product photographs, so the page opened on two competing images. This one
 *    is an originated editorial frame under
 *    `docs/designs/2026-08-21-originated-imagery-art-direction-design.md` —
 *    it depicts no product, so it does not compete with the wall; it states a
 *    register the wall then fills in.
 *
 *    D2's second argument was the preload, and that one had already inverted.
 *    `landing-zones.tsx` and `selected-product-tile.tsx` both still withheld
 *    `priority` on the grounds that "the hero photograph owns the page's single
 *    preload" — after the hero that owned it was deleted. `/` has been running
 *    with a text LCP and an unclaimed preload budget. `EditorialHero` claims it.
 *
 *    Note the old copy of this comment credited the removal to D1/D18. Wrong:
 *    those are ledger rows about opening editorially and moving the categories
 *    into the nav. Neither mentions the photograph.
 * 2. **No chip row.** All thirteen L1s moved into the persistent nav, which
 *    now renders them on `/` too. Keeping a copy here would put thirteen
 *    duplicate category links inside one viewport of the thirteen above.
 * 3. **No sentinel.** `[data-hero-sentinel]` existed for one reader — the
 *    header's IntersectionObserver, which revealed the nav search once the
 *    hero scrolled away. That search is unconditional now, so both sides go.
 *
 * The text is left-aligned, not centred: every zone below shares one reading
 * edge, and a centred opener is the one thing that breaks it. The frame runs to
 * the page measure above it while the text stays at prose-measure — the band is
 * the only full-width element here, and widening the text to match would undo
 * the reading edge the whole page is built on.
 */
export default async function HeroSection() {
  const t = await getTranslations('landing.hero')

  return (
    <PageShell as="section" measure="page" className="py-section">
      {/* `alt=""`, the same call story and trail detail make: the `<h1>` two
          nodes below says what this is, and a screen reader repeating the
          promise as image text is noise, not description. The frame carries no
          information the heading does not. */}
      <EditorialHero src={HERO_IMAGE} alt="" className="mb-stack" />

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
        <span className="block type-eyebrow">{t('eyebrow')}</span>

        {/* The consumer promise, verbatim. `type-display` from `md` up; the
            page-title role below it, because 46px zh-TW characters overflow a
            390px viewport at this string's length. */}
        <h1 className="mt-4 type-page-title md:type-display text-balance">{t('headline')}</h1>

        {/* FIRST PROSE NODE, AND IT STAYS THAT WAY (DEV-1320). Google lifted a
            rotating brand blurb as the homepage snippet when it was not, and
            seo.spec.ts asserts this exact string is visible on `/`. The lede
            under it is the mock's editorial copy, which is longer and cannot
            take this position. */}
        <p className="mt-6 type-body text-ink-soft">
          {t('subheadline')}
        </p>
        <p className="mt-3 type-body text-ink-soft">{t('lede')}</p>

        {/* One control, one alternative. The field redirects to
            /brands?search=, which is the exact entry point the WebSite JSON-LD
            declares as its SearchAction. */}
        <div className="mt-8 flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          {/* SearchInput reads useSearchParams, which bails out of static
              prerendering unless it sits under a Suspense boundary. The
              fallback reserves the field's height so the opener does not
              shift. */}
          <Suspense fallback={<div className="h-11 w-full flex-1" aria-hidden="true" />}>
            <SearchInput
              redirectTo={routes.brands()}
              placeholder={t('searchPlaceholder')}
              formAriaLabel={t('searchLabel')}
              className="max-w-none flex-1"
            />
          </Suspense>

          {/* A `div`, not a `p`: `p` is reserved for prose here so the
              DEV-1320 guard above keeps counting only prose. */}
          <div className="flex items-center gap-3">
            <span className="type-metadata">{t('browsePrefix')}</span>
            {/* /discover, NOT an in-page `#` anchor to the style zone. That zone
                is withheld when nothing is published, and a fragment pointing
                at an element that does not exist is a dead control that still
                looks live. */}
            <Link
              href={routes.discover()}
              className="inline-flex min-h-11 items-center gap-1 rounded-[4px] type-nav text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
            >
              {t('browseCta')}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
