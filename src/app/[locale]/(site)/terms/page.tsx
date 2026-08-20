import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { routes } from '@/lib/routes'

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
  const { canonical, languages } = buildAlternates(routes.terms(), safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  }
}

const sectionKeys = [
  'contentOwnership',
  'dataUse',
  'automatedAccess',
  'reviewProcess',
  'disclaimer',
  'changes',
] as const

/**
 * Sections that carry a second paragraph under `<key>.bodyDetail`. Listing them
 * explicitly (rather than probing the catalogue) keeps the loop total: a section
 * without an entry here renders exactly one paragraph, as all nine others do,
 * and a missing key can never surface as a raw message path in the page.
 */
const sectionKeysWithDetail = new Set<(typeof sectionKeys)[number]>(['automatedAccess'])

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms')

  return (
    <main className="page-gutter mx-auto w-full page-measure py-10">
      <div className="grid gap-10 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-16">
        <aside className="space-y-4 md:sticky md:top-(--nav-height) md:self-start">
          <h1 className="type-section">{t('title')}</h1>
          <p className="type-body-sm">{t('intro')}</p>
          <p className="type-body-sm">{t('lastUpdated')}</p>
        </aside>
        <div className="divide-y divide-border">
          {sectionKeys.map((key) => (
            <section key={key} className="space-y-3 py-6 first:pt-0">
              <h2 className="type-section">
                {t(`${key}.heading`)}
              </h2>
              <p className="type-body-sm">
                {t(`${key}.body`)}
              </p>
              {sectionKeysWithDetail.has(key) && (
                <p className="type-body-sm">
                  {t(`${key}.bodyDetail`)}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
