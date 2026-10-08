import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'
import { CONTACT_EMAILS } from '@/lib/constants'

// Bounds the edge copy to an hour under the Cloudflare HTML cache rule
// (DEV-1961); without it Next sends s-maxage=31536000.
export const revalidate = 3600

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

const inlineLinkClassName =
  'rounded-control break-words text-accent underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground'

const tocLinkClassName =
  'inline-flex min-h-11 items-center rounded-control type-body-sm text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms')
  const tLegal = await getTranslations('legal')

  const emailLinks = {
    hello: (chunks: ReactNode) => (
      <a href={`mailto:${CONTACT_EMAILS.contact}`} className={inlineLinkClassName}>
        {chunks}
      </a>
    ),
  }

  return (
    // A page that is read, so it takes the prose measure (DESIGN.md §4).
    <PageShell as="main" measure="prose" className="py-10">
      <header className="space-y-4 border-b border-rule pb-8">
        <h1 className="type-page-title">{t('title')}</h1>
        <p className="type-body">{t('intro')}</p>
        <p className="type-body-sm text-ink-muted">{t('lastUpdated')}</p>
        <nav aria-labelledby="terms-toc-heading">
          <p id="terms-toc-heading" className="type-body-sm font-semibold text-ink">
            {tLegal('onThisPage')}
          </p>
          <ol className="mt-1">
            {sectionKeys.map((key) => (
              <li key={key}>
                <a href={`#${key}`} className={tocLinkClassName}>
                  {t(`${key}.heading`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>
      <div className="divide-y divide-rule">
        {sectionKeys.map((key) => (
          <section key={key} id={key} className="scroll-mt-24 space-y-3 py-8">
            <h2 className="type-section">{t(`${key}.heading`)}</h2>
            <p className="type-body">{t.rich(`${key}.body`, emailLinks)}</p>
            {sectionKeysWithDetail.has(key) && (
              <p className="type-body">{t.rich(`${key}.bodyDetail`, emailLinks)}</p>
            )}
          </section>
        ))}
      </div>
    </PageShell>
  )
}
