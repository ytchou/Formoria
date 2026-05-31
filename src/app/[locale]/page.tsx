import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildWebSiteJsonLd } from '@/lib/json-ld'
import HeroSection from '@/components/landing/hero-section'
import TrustBar from '@/components/landing/trust-bar'
import Manifesto from '@/components/landing/manifesto'
import BrandShowcase from '@/components/shared/brand-showcase'
import FilterableBrandShowcase from '@/components/landing/filterable-brand-showcase'
import ValueChips from '@/components/landing/value-chips'
import DualCta from '@/components/landing/dual-cta'
import { getBrandStats, getBrands, getNewBrands } from '@/lib/services/brands'
import { getActiveCategories, getValueTagsWithCoverage } from '@/lib/services/taxonomy'

export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing.metadata')
  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: { canonical: '/' },
    openGraph: {
      title: t('title'),
      description: t('description'),
    },
  }
}

export default async function LandingPage() {
  const t = await getTranslations('landing')
  const jsonLd = buildWebSiteJsonLd()

  const [stats, categories, { brands: allBrands }, newBrands, valueTags] = await Promise.all([
    getBrandStats(),
    getActiveCategories(),
    getBrands({ status: 'approved' }),
    getNewBrands(4),
    getValueTagsWithCoverage(1),
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main>
        <HeroSection />

        <div className="bg-secondary">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
            <TrustBar brandCount={stats.brandCount} categoryCount={stats.categoryCount} />
          </div>
        </div>

        <div className="py-6 md:py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <FilterableBrandShowcase brands={allBrands} categories={categories} />
          </div>
        </div>

        <div className="py-6 md:py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <ValueChips tags={valueTags} />
          </div>
        </div>

        <Manifesto />

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

        <DualCta />
      </main>
    </>
  )
}
