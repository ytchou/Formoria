import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { PageShell } from '@/components/ui/page-shell'
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
    /*
      THE SHELL IS `page`, NOT `prose`, BECAUSE THIS IS A TWO-COLUMN PAGE.
      A 48rem shell would leave the sticky aside its 18rem and the legal text
      336px — tight past the point of reading. So the page keeps the wide
      measure and only the prose is capped.

      AND THE CAPPED PROSE IS NOT CENTRED. `prose-measure` without `mx-auto`
      leaves the slack on the right, so every paragraph's left edge sits on the
      same line as its heading, the aside and the header above it. Adding
      `mx-auto` here would centre each paragraph in its column and break that
      line — it reads like a fix and is the opposite of one.
    */
    <PageShell as="main" measure="page" className="py-10">
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
              <p className="prose-measure type-body-sm">
                {t(`${key}.body`)}
              </p>
              {sectionKeysWithDetail.has(key) && (
                <p className="prose-measure type-body-sm">
                  {t(`${key}.bodyDetail`)}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
