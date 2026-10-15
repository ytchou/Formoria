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
  const t = await getTranslations('legal.privacy.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates(routes.privacy(), safeLocale)
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
  'dataCollection',
  'purpose',
  'thirdParty',
  'userRights',
  'dataProtection',
  'cookies',
  'changes',
  'contact',
] as const

export default async function PrivacyPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.privacy')
  const tLegal = await getTranslations('legal')

  const emailLinks = {
    privacy: (chunks: ReactNode) => (
      <a href={`mailto:${CONTACT_EMAILS.privacy}`} className={legalInlineLinkClassName}>
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
        </LegalSection>
      ))}
    </LegalDocument>
  )
}
