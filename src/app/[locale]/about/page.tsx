import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildArticleJsonLd, buildOrganizationJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { Link } from '@/i18n/navigation'
import AboutHero from '@/components/about/about-hero'
import OriginStory from '@/components/about/origin-story'
import TaiwanStats from '@/components/about/taiwan-stats'
import MissionPillars from '@/components/about/mission-pillars'
import { buttonVariants } from '@/components/ui/button'
import { TrustModel } from '@/components/about/trust-model'
import { getBrandStats, getRecentBrandCount } from '@/lib/services/brands'

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

  const [stats, recentBrands] = await Promise.all([
    getBrandStats().catch(() => ({ brandCount: 0, categoryCount: 0 })),
    getRecentBrandCount().catch(() => ({ count: 0, period: '30d' as const })),
  ])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(articleJsonLd) }}
      />
      <main>
        <AboutHero
          brandCount={stats.brandCount}
          categoryCount={stats.categoryCount}
          recentBrands={recentBrands}
        />

        <OriginStory
          heading={t('origin.heading')}
          body1={t('origin.body1')}
          body2={t('origin.body2')}
          body3={t('origin.body3')}
        />

        <TaiwanStats
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

        <section className="py-12 md:py-16">
          <div className="page-gutter mx-auto max-w-6xl">
            <h2 className="type-section-title-large text-balance">{t('qualifies.heading')}</h2>
            <p className="mt-4 max-w-3xl type-page-subtitle text-pretty">
              {t('qualifies.body')}
            </p>
          </div>
        </section>

        <TrustModel />

        <section className="relative overflow-hidden py-12 md:py-16">
          <Image
            src="/images/hero-bg.png"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-right"
          />
          <div className="absolute inset-0 bg-background/75" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl page-gutter">
            <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="type-page-title-large text-balance">{t('guide.heading')}</h2>
                <p className="mt-3 max-w-prose type-body-muted text-pretty">{t('guide.body')}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/brands"
                  className={buttonVariants({
                    variant: 'primary',
                    tone: 'cta',
                    size: 'large',
                    className: 'min-h-12',
                  })}
                >
                  {t('hero.cta')}
                </Link>
                <Link
                  href="/getting-started"
                  className={buttonVariants({
                    variant: 'secondary',
                    size: 'large',
                    className: 'min-h-12',
                  })}
                >
                  {t('guide.cta')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
