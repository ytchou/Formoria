import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildArticleJsonLd, buildOrganizationJsonLd } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import AboutHero from '@/components/about/about-hero'
import OriginStory from '@/components/about/origin-story'
import TaiwanStats from '@/components/about/taiwan-stats'
import MissionPillars from '@/components/about/mission-pillars'
import HowItWorks from '@/components/about/how-it-works'
import { TrustModel } from '@/components/about/trust-model'
import { getBrandStats } from '@/lib/services/brands'

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

  const stats = await getBrandStats()

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

        <OriginStory
          heading={t('origin.heading')}
          body1={t('origin.body1')}
          body2={t('origin.body2')}
          body3={t('origin.body3')}
        />

        <TaiwanStats
          eyebrow={t('taiwanStats.eyebrow')}
          heading={t('taiwanStats.heading')}
          intro={t('taiwanStats.intro')}
          items={[
            {
              value: t('taiwanStats.items.count.value'),
              label: t('taiwanStats.items.count.label'),
              detail: t('taiwanStats.items.count.detail'),
            },
            {
              value: t('taiwanStats.items.share.value'),
              label: t('taiwanStats.items.share.label'),
              detail: t('taiwanStats.items.share.detail'),
            },
            {
              value: t('taiwanStats.items.employment.value'),
              label: t('taiwanStats.items.employment.label'),
              detail: t('taiwanStats.items.employment.detail'),
            },
          ]}
          note={t('taiwanStats.note')}
          sourceLabel={t('taiwanStats.sourceLabel')}
          sourceName={t('taiwanStats.sourceName')}
        />

        <MissionPillars
          heading={t('mission.heading')}
          statement={t('mission.statement')}
          pillars={[
            { heading: t('mission.promote.heading'), body: t('mission.promote.body') },
            { heading: t('mission.smallBusiness.heading'), body: t('mission.smallBusiness.body') },
            { heading: t('mission.platform.heading'), body: t('mission.platform.body') },
          ]}
        />

        <HowItWorks
          heading={t('howItWorks.heading')}
          steps={[
            { label: t('howItWorks.submit.label'), description: t('howItWorks.submit.description') },
            { label: t('howItWorks.review.label'), description: t('howItWorks.review.description') },
            { label: t('howItWorks.publish.label'), description: t('howItWorks.publish.description') },
          ]}
          cta={t('howItWorks.cta')}
        />

        <TrustModel />
      </main>
    </>
  )
}
