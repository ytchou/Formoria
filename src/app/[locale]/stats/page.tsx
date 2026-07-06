import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { getStatsPageData } from '@/lib/services/stats'
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
    <main className="mx-auto w-full max-w-5xl bg-background px-6 py-8 font-sans text-foreground md:px-10 md:py-12">
      <div className="space-y-12">
        <section className="space-y-3">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">{t('hero.subtitle')}</p>
          <h1 className="font-heading text-[1.625rem] font-bold leading-[1.2] text-foreground">
            {t('hero.title')}
          </h1>
          <div className="space-y-1">
            <p className="text-sm font-normal text-foreground">
              {t('hero.totalBrands', { count: data.totalBrands })}
            </p>
            <p className="text-xs font-normal text-muted-foreground">
              {t('hero.asOf', { date: formattedDate })}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-heading text-base font-bold leading-[1.3] text-foreground">
              {t('categories.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('categories.description', { count: data.totalBrands })}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid gap-3">
              {data.categoryBreakdown.map((item) => (
                <Link
                  key={item.slug}
                  href={`/brands?category=${encodeURIComponent(item.slug)}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3 transition-colors hover:bg-secondary"
                >
                  <span className="text-sm font-medium text-foreground">{item.category}</span>
                  <span className="text-[0.8125rem] font-medium text-muted-foreground">
                    {t('categories.brandCount', { count: item.count })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-heading text-base font-bold leading-[1.3] text-foreground">
              {t('mitVerified.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('mitVerified.description', {
                verified: data.mitVerifiedShare.verified,
                total: data.mitVerifiedShare.total,
                percentage: data.mitVerifiedShare.percentage,
              })}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="font-heading text-[1.625rem] font-bold leading-[1.2] text-foreground">
              {data.mitVerifiedShare.percentage}%
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-heading text-base font-bold leading-[1.3] text-foreground">
              {t('geographicDistribution')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('geographicDistributionDesc')}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <TaiwanMapDynamic data={data.cityCoverage} />
            {data.cityCoverage.length > 0 && (
              <ol className="mt-4 space-y-1.5">
                {data.cityCoverage.slice(0, 10).map(({ city, count }, index) => (
                  <li key={city} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-5 text-right text-muted-foreground">{index + 1}.</span>
                      <span>{tCities(city)}</span>
                    </span>
                    <span className="font-medium">{count}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {data.foundingDecadeDistribution.length > 0 ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="font-heading text-base font-bold leading-[1.3] text-foreground">
                {t('foundingDecade.title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('foundingDecade.description')}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3">
                {data.foundingDecadeDistribution.map((item) => (
                  <div key={item.decade} className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-foreground">{item.decade}</span>
                    <span className="text-[0.8125rem] font-medium text-muted-foreground">
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
