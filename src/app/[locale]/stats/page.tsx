import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildArticleJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { getStatsPageData } from '@/lib/services/stats'

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
  const [t, data] = await Promise.all([
    getTranslations('stats'),
    getStatsPageData(),
  ])
  const articleJsonLd = buildArticleJsonLd({
    title: t('metadata.title'),
    description: t('metadata.description'),
    path: '/stats',
    locale: safeLocale,
  })
  const formattedDate = formatDate(new Date(), safeLocale)

  return (
    <main className="mx-auto w-full max-w-5xl bg-background px-6 py-8 font-sans text-foreground md:px-10 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(articleJsonLd) }}
      />

      <div className="space-y-12">
        <section className="space-y-3">
          <p className="text-[13px] font-medium text-muted-foreground">{t('hero.subtitle')}</p>
          <h1 className="font-heading text-[26px] font-bold leading-tight text-foreground">
            {t('hero.title')}
          </h1>
          <div className="space-y-1">
            <p className="text-sm font-normal text-foreground">
              {t('hero.totalBrands', { count: data.totalBrands })}
            </p>
            <p className="text-[12px] font-normal text-muted-foreground">
              {t('hero.asOf', { date: formattedDate })}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-heading text-[16px] font-bold text-foreground">
              {t('categories.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('categories.description', { count: data.categoryBreakdown.length })}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="grid gap-3">
              {data.categoryBreakdown.map((item) => (
                <Link
                  key={item.slug}
                  href={`/brands?category=${encodeURIComponent(item.slug)}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground">{item.category}</span>
                  <span className="text-[13px] font-medium text-muted-foreground">
                    {t('categories.brandCount', { count: item.count })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-heading text-[16px] font-bold text-foreground">
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
            <p className="text-[26px] font-bold leading-tight text-foreground">
              {data.mitVerifiedShare.percentage}%
            </p>
          </div>
        </section>

        {data.foundingDecadeDistribution.length > 0 ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="font-heading text-[16px] font-bold text-foreground">
                {t('foundingDecade.title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('foundingDecade.description')}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3">
                {data.foundingDecadeDistribution.map((item) => (
                  <div key={item.decade} className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-foreground">{item.decade}</span>
                    <span className="text-[13px] font-medium text-muted-foreground">
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
