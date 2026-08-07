import Image from 'next/image'
import { Suspense } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import { SearchInput } from '@/components/brands/search-input'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import { HeroStats } from '@/components/landing/hero-stats'
import { categoryLabel, PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

interface HeroSectionProps {
  /** Omitted when the brand count could not be read — renders no figure rather than a false zero. */
  brandCount?: number
  categoryCount: number
}

export default async function HeroSection({ brandCount, categoryCount }: HeroSectionProps) {
  const [t, locale] = await Promise.all([getTranslations('landing.hero'), getLocale()])

  return (
    <section className="relative overflow-hidden py-12 md:py-20">
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        preload
        sizes="100vw"
        className="object-cover object-right"
      />
      <div className="absolute inset-0 bg-background/70 md:bg-background/45" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl page-gutter">
        <h1 className="type-hero">{t('headline')}</h1>
        {/* Opens with the stable entity sentence and stays the first prose in the DOM:
            without it the earliest body text is rotating brand-card copy, which Google
            was lifting as the homepage snippet (DEV-1320). Mirrors
            landing.metadata.description. */}
        <p className="mt-3 type-page-subtitle max-w-2xl">{t('subheadline')}</p>

        <div className="mt-6 max-w-md rounded-lg bg-background/85">
          <Suspense>
            <SearchInput redirectTo="/brands" placeholder={t('cta')} />
          </Suspense>
        </div>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label={t('statsCategories')}>
          <HeroCategoryChips
            categories={PRODUCT_TYPE_CATEGORIES.map((cat) => ({
              slug: cat.slug,
              label: categoryLabel(cat, locale),
            }))}
          />
        </nav>

        <HeroStats
          brandCount={brandCount}
          brandLabel={t('statsBrands')}
          categoryCount={categoryCount}
          categoryLabel={t('statsCategories')}
        />
      </div>
    </section>
  )
}
