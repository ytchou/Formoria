import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { CONTACT_EMAILS } from '@/lib/constants'
import { FaqSection } from '@/components/shared/faq-section'
import { OpenTargetDetails } from './open-target-details'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('faq.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/faq', safeLocale)
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

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('faq')

  const generalItemKeys = [
    'whatIsFormoria',
    'taiwaneseBrandCriteria',
    'whoCanSubmit',
    'whatDoesMitMean',
    'howToSubmit',
    'reviewTime',
    'dataAccuracy',
    'isBrandFree',
    'whatCategories',
    'languageSupport',
    'howVerified',
  ] as const
  const ownerItemKeys = [
    'claimBenefits',
    'claimOrUpdate',
    'editBrand',
    'profileCompleteness',
    'mitVerification',
    'ownerAnalytics',
    'editModeration',
    'brandLocations',
  ] as const

  return (
    <main className="page-gutter mx-auto w-full max-w-screen-xl py-10">
      <OpenTargetDetails />
      <div className="grid gap-10 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-16">
        <aside className="space-y-4 md:sticky md:top-24 md:self-start">
          <h1 id="faq-heading" className="type-page-title">
            {t('title')}
          </h1>
          <nav
            aria-label={t('sections.navigation')}
            className="space-y-1 border-l border-border pl-3"
          >
            <a
              href="#general"
              className="flex min-h-12 items-center px-3 type-nav-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('sections.general')}
            </a>
            <a
              href="#for-owners"
              className="flex min-h-12 items-center px-3 type-nav-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('sections.forOwners')}
            </a>
          </nav>
          <p className="type-body-muted">
            {t.rich('intro', {
              contact: (chunks) => (
                <a href={`mailto:${CONTACT_EMAILS.contact}`} className="type-link">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </aside>
        <div role="region" aria-labelledby="faq-heading" className="space-y-10">
          <FaqSection id="general" title={t('sections.general')}>
            <div className="divide-y divide-border">
              {generalItemKeys.map((key, i) => (
                <details key={i} className="group scroll-mt-24 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between type-faq-question [&::-webkit-details-marker]:hidden">
                    {t(`items.${key}.question`)}
                    <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 max-w-2xl type-body-muted">
                    {t(`items.${key}.answer`)}
                  </p>
                </details>
              ))}
              <details className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between type-faq-question [&::-webkit-details-marker]:hidden">
                  {t('items.contact.question')}
                  <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="mt-3 max-w-2xl type-body-muted">
                  {t.rich('items.contact.answer', {
                    email: CONTACT_EMAILS.contact,
                    mail: (chunks) => (
                      <a
                        href={`mailto:${CONTACT_EMAILS.contact}`}
                        className="underline underline-offset-4"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </details>
            </div>
          </FaqSection>
          <FaqSection id="for-owners" title={t('sections.forOwners')}>
            <div className="divide-y divide-border">
              {ownerItemKeys.map((key, i) => (
                <details
                  key={i}
                  id={key === 'claimBenefits' ? 'claim' : undefined}
                  className="group scroll-mt-24 py-5"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between type-faq-question [&::-webkit-details-marker]:hidden">
                    {t(`items.${key}.question`)}
                    <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 max-w-2xl type-body-muted">
                    {t(`items.${key}.answer`)}
                  </p>
                </details>
              ))}
            </div>
          </FaqSection>
        </div>
      </div>
    </main>
  )
}
