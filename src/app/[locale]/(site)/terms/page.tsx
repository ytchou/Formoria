import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import {
  LegalDocument,
  LegalSection,
  legalInlineLinkClassName,
} from '@/components/legal/legal-document'
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

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms')
  const tLegal = await getTranslations('legal')

  const emailLinks = {
    hello: (chunks: ReactNode) => (
      <a href={`mailto:${CONTACT_EMAILS.contact}`} className={legalInlineLinkClassName}>
        {chunks}
      </a>
    ),
  }

  return (
    <LegalDocument
      title={t('title')}
      intro={t('intro')}
      lastUpdated={t('lastUpdated')}
      tocLabel={tLegal('onThisPage')}
      tocItems={sectionKeys.map((key) => ({ id: key, label: t(`${key}.heading`) }))}
    >
      {sectionKeys.map((key) => (
        <LegalSection key={key} id={key} heading={t(`${key}.heading`)}>
          <p className="type-body">{t.rich(`${key}.body`, emailLinks)}</p>
          {sectionKeysWithDetail.has(key) && (
            <p className="type-body">{t.rich(`${key}.bodyDetail`, emailLinks)}</p>
          )}
        </LegalSection>
      ))}
    </LegalDocument>
  )
}
