import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/json-ld'
import HeroSection from '@/components/landing/hero-section'
import Manifesto from '@/components/landing/manifesto'
import { NewsletterSection } from '@/components/landing/newsletter-section'
import BrandShowcase from '@/components/shared/brand-showcase'
import FilterableBrandShowcase from '@/components/landing/filterable-brand-showcase'
import SubmitBand from '@/components/landing/submit-band'
import ValueChips from '@/components/landing/value-chips'
import { getBrands, getNewBrands } from '@/lib/services/brands'
import { getActiveCategories, getTags } from '@/lib/services/taxonomy'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

export const revalidate = 3600

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('landing.metadata')
  const { canonical, languages } = buildAlternates('/', safeLocale)

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: { canonical, languages },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
  }
}

export default async function LandingPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('landing')
  const jsonLd = buildWebSiteJsonLd(safeLocale)
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale)

  const [categories, { brands: fetchedBrands, totalCount: totalBrandCount }, newBrands, valueTags] = await Promise.all([
    getActiveCategories(),
    getBrands({ status: 'approved', limit: 60 }),
    getNewBrands(4),
    getTags('value'),
  ])

  const allBrands = shuffle(fetchedBrands)
  const valueBrands = shuffle(fetchedBrands)
  const verifiedBrands = allBrands.filter((brand) => brand.isVerified)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <main>
        <HeroSection brandCount={totalBrandCount} categoryCount={categories.length} />
        <NewsletterSection />

        <SavedBrandsProvider>
          <div className="py-6 md:py-8">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <FilterableBrandShowcase brands={allBrands} categories={categories} />
            </div>
          </div>

          <div className="py-6 md:py-8">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <BrandShowcase
                brands={verifiedBrands}
                heading={t('verifiedRail.heading')}
                linkText={t('newBrands.linkText')}
                linkHref="/brands?verification=mit-verified"
              />
            </div>
          </div>

          <Manifesto />

          <div className="py-6 md:py-8">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <ValueChips brands={valueBrands} tags={valueTags} />
            </div>
          </div>

          <SubmitBand />

          <div className="py-6 md:py-8">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <BrandShowcase
                brands={newBrands}
                heading={t('newBrands.heading')}
                linkText={t('newBrands.linkText')}
                linkHref="/brands"
              />
            </div>
          </div>
        </SavedBrandsProvider>
      </main>
    </>
  )
}
