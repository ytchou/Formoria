import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildArticleJsonLd, buildOrganizationJsonLd } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import AboutHero from '@/components/about/about-hero'
import OriginStory from '@/components/about/origin-story'
import WhatIsMit from '@/components/about/what-is-mit'
import MissionPillars from '@/components/about/mission-pillars'
import StatsBar from '@/components/about/stats-bar'
import BrandShowcase from '@/components/shared/brand-showcase'
import HowItWorks from '@/components/about/how-it-works'
import AboutCta from '@/components/about/about-cta'
import { getBrandStats, getRandomBrands } from '@/lib/services/brands'

export const revalidate = 3600

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('about.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/about', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function AboutPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('about')
  const metadataT = await getTranslations('about.metadata')
  const title = metadataT('title')
  const description = metadataT('description')
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale)
  const articleJsonLd = buildArticleJsonLd({ title, description, path: '/about', locale: safeLocale })

  const [stats, randomBrands] = await Promise.all([
    getBrandStats(),
    getRandomBrands(4),
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <main>
        <AboutHero
          brandCount={stats.brandCount}
          categoryCount={stats.categoryCount}
        />

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <OriginStory />
          </div>
        </div>

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <WhatIsMit
              heading={t('whatIsMit.heading')}
              body1={t('whatIsMit.body1')}
              body2={t('whatIsMit.body2')}
            />
          </div>
        </div>

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <MissionPillars
              heading={t('mission.heading')}
            />
          </div>
        </div>

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <StatsBar
              brandCount={stats.brandCount}
              categoryCount={stats.categoryCount}
              brandUnit={t('stats.brandUnit')}
              categoryUnit={t('stats.categoryUnit')}
            />
          </div>
        </div>

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <BrandShowcase
              brands={randomBrands}
              heading={t('showcase.heading')}
              linkText={t('showcase.linkText')}
              linkHref="/brands"
            />
          </div>
        </div>

        <div className="py-12 md:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <HowItWorks
              heading={t('howItWorks.heading')}
              steps={[
                { label: t('howItWorks.submit.label'), description: t('howItWorks.submit.description') },
                { label: t('howItWorks.review.label'), description: t('howItWorks.review.description') },
                { label: t('howItWorks.publish.label'), description: t('howItWorks.publish.description') },
              ]}
              cta={t('howItWorks.cta')}
            />
          </div>
        </div>

        <AboutCta />
      </main>
    </>
  )
}
