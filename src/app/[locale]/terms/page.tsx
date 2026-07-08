import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('legal.terms.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/terms', safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

const sectionKeys = [
  'contentOwnership',
  'dataUse',
  'reviewProcess',
  'disclaimer',
  'changes',
] as const

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms')

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="grid gap-10 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-16">
        <aside className="space-y-4 md:sticky md:top-24 md:self-start">
          <h1 className="type-page-title">{t('title')}</h1>
          <p className="type-body-muted">{t('intro')}</p>
          <p className="type-body-muted">{t('lastUpdated')}</p>
        </aside>
        <div className="divide-y divide-border">
          {sectionKeys.map((key) => (
            <section key={key} className="space-y-3 py-6 first:pt-0">
              <h2 className="type-section-title-large">
                {t(`${key}.heading`)}
              </h2>
              <p className="type-body-muted">
                {t(`${key}.body`)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
