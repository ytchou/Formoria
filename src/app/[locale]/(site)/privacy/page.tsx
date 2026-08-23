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

  return (
    // Wide shell, narrow prose, no `mx-auto` on the cap — same two-column
    // arrangement as `terms/page.tsx`, and the reasoning is written out there.
    <PageShell as="main" measure="page" className="py-10">
      <div className="grid gap-10 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-16">
        <aside className="space-y-4 md:sticky md:top-(--nav-height) md:self-start">
          <h1 className="type-section">{t('title')}</h1>
          <p className="type-body-sm">{t('intro')}</p>
          <p className="type-body-sm">{t('lastUpdated')}</p>
        </aside>
        <div className="divide-y divide-rule">
          {sectionKeys.map((key) => (
            <section key={key} className="space-y-3 py-6 first:pt-0">
              <h2 className="type-section">
                {t(`${key}.heading`)}
              </h2>
              <p className="prose-measure type-body-sm">
                {t(`${key}.body`)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
