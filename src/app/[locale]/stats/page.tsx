import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { getStatsPageData } from '@/lib/services/stats'
import { surfaceCardStyles } from '@/components/ui/card'
import { TaiwanMapDynamic } from '@/components/stats/TaiwanMapDynamic'

interface StatsPageProps {
  params: Promise<{ locale: string }>
}

export const revalidate = 3600

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { canonical, languages } = buildAlternates('/stats', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
  const t = await getTranslations('stats.metadata')

  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical, languages },
    openGraph: {
      title: t('title'),
      description: t('description'),
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      title: t('title'),
      description: t('description'),
    },
  }
}

export default async function StatsPage({ params }: StatsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const [t, tCities, data] = await Promise.all([
    getTranslations('stats'),
    getTranslations('cities'),
    getStatsPageData(),
  ])
  const formattedDate = formatDate(new Date(), safeLocale)

  return (
    <main className="page-gutter mx-auto w-full max-w-5xl bg-background py-8 text-foreground md:py-12">
      <div className="space-y-12">
        <section className="space-y-3">
          <p className="type-metadata">{t('hero.subtitle')}</p>
          <h1 className="type-page-title">
            {t('hero.title')}
          </h1>
          <div className="space-y-1">
            <p className="type-body">
              {t('hero.totalBrands', { count: data.totalBrands })}
            </p>
            <p className="type-caption">
              {t('hero.asOf', { date: formattedDate })}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="type-section-title">
              {t('categories.title')}
            </h2>
            <p className="type-card-description">
              {t('categories.description', { count: data.totalBrands })}
            </p>
          </div>
          <div className={surfaceCardStyles({ padding: 'sm' })}>
            <div className="grid gap-3">
              {data.categoryBreakdown.map((item) => (
                <Link
                  key={item.slug}
                  href={`/brands?category=${encodeURIComponent(item.slug)}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3 transition-colors hover:bg-secondary"
                >
                  <span className="type-body-emphasis">{item.category}</span>
                  <span className="type-metadata">
                    {t('categories.brandCount', { count: item.count })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="type-section-title">
              {t('mitVerified.title')}
            </h2>
            <p className="type-card-description">
              {t('mitVerified.description', {
                verified: data.mitVerifiedShare.verified,
                total: data.mitVerifiedShare.total,
                percentage: data.mitVerifiedShare.percentage,
              })}
            </p>
          </div>
          <div className={surfaceCardStyles({ padding: 'sm' })}>
            <p className="type-page-title">
              {data.mitVerifiedShare.percentage}%
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="type-section-title">
              {t('geographicDistribution')}
            </h2>
            <p className="type-card-description">{t('geographicDistributionDesc')}</p>
          </div>
          <div className={surfaceCardStyles({ padding: 'sm' })}>
            <TaiwanMapDynamic data={data.cityCoverage} />
            {data.cityCoverage.length > 0 && (
              <ol className="mt-4 space-y-1.5">
                {data.cityCoverage.slice(0, 10).map(({ city, count }, index) => (
                  <li key={city} className="flex items-center justify-between type-body">
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-right type-caption">{index + 1}.</span>
                      <span>{tCities(city)}</span>
                    </span>
                    <span className="type-body-emphasis">{count}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {data.foundingDecadeDistribution.length > 0 ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="type-section-title">
                {t('foundingDecade.title')}
              </h2>
              <p className="type-card-description">{t('foundingDecade.description')}</p>
            </div>
            <div className={surfaceCardStyles({ padding: 'sm' })}>
              <div className="grid gap-3">
                {data.foundingDecadeDistribution.map((item) => (
                  <div key={item.decade} className="flex items-center justify-between gap-4">
                    <span className="type-body-emphasis">{item.decade}</span>
                    <span className="type-metadata">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
