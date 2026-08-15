import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'
import { HeroCategoryChips } from '@/components/landing/hero-category-chips'
import { SectionBandCtaLink } from '@/components/landing/section-band-cta-link'
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
        <h1 className="type-page-title-large md:type-hero">{t('headline')}</h1>
        {/* Keeps the approved present positioning as the first prose in the DOM:
            otherwise the earliest body text is rotating brand-card copy, which Google
            was lifting as the homepage snippet (DEV-1320). Metadata carries the full
            mission separately. */}
        <p className="mt-3 type-page-subtitle max-w-2xl">{t('subheadline')}</p>

        <nav className="mt-6 hidden flex-wrap gap-2 md:flex" aria-label={t('statsCategories')}>
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
          className="mt-6 flex min-w-0 gap-2 overflow-x-auto pb-1 md:hidden"
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

        <p className="mt-5 type-body">
          <SectionBandCtaLink
            href="/brands"
            label={t('knownIntent')}
            ctaName="known_intent"
            className="inline-flex min-h-12 items-center font-medium text-primary"
          />
        </p>
      </div>
    </section>
  )
}
