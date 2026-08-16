import { Suspense } from 'react'
import { Link } from '@/i18n/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import { SearchInput } from '@/components/brands/search-input'
import { buttonVariants } from '@/components/ui/button'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

const HERO_CATEGORY_SLUGS = [
  'home',
  'food-drink',
  'crafts',
  'stationery',
  'beauty',
  'fashion',
  'bags-accessories',
] as const

export default async function HeroSection() {
  const [t, locale] = await Promise.all([getTranslations('landing.hero'), getLocale()])
  const categories = HERO_CATEGORY_SLUGS.flatMap((slug) => {
    const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug)
    return category
      ? [{ slug: category.slug, label: categoryLabel(category, locale) }]
      : []
  })

  return (
    <section className="py-12 md:py-20">
      <div className="mx-auto max-w-6xl page-gutter">
        {/* Centring is visual only — the DOM order below is the reading order,
            and everything after the control group returns to the page gutter. */}
        <div className="mx-auto flex max-w-[1000px] flex-col items-center text-center">
          <h1 className="type-page-title-large md:type-hero">{t('headline')}</h1>
          {/* Keeps the approved present positioning as the first prose in the DOM:
              otherwise the earliest body text is rotating brand-card copy, which Google
              was lifting as the homepage snippet (DEV-1320). Metadata carries the full
              mission separately. */}
          <p className="mt-3 type-page-subtitle">{t('subheadline')}</p>

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
                tone: 'cta',
                className: 'shrink-0',
              })}
            >
              {t('browseCta')}
            </Link>
          </div>
        </div>

        <nav className="mt-8 hidden flex-wrap gap-2 md:flex" aria-label={t('statsCategories')}>
          <HeroCategoryChips
            categories={categories.slice(0, 5)}
          />
          <Link
            href="/brands"
            data-ph-no-autocapture
            className="inline-flex min-h-12 items-center px-2 font-medium text-primary"
          >
            {t('allCategories')}
          </Link>
        </nav>

        <nav
          className="mt-8 flex min-w-0 gap-2 overflow-x-auto pb-1 md:hidden"
          aria-label={t('statsCategories')}
        >
          <HeroCategoryChips categories={categories.slice(0, 7)} />
          <Link
            href="/brands"
            data-ph-no-autocapture
            className="inline-flex min-h-12 shrink-0 items-center px-2 font-medium text-primary"
          >
            {t('allCategories')}
          </Link>
        </nav>
      </div>
    </section>
  )
}
