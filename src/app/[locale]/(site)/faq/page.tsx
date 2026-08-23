import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { Link } from '@/i18n/navigation'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { OpenTargetDetails } from '@/components/shared/open-target-details'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'

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
  const { canonical, languages } = buildAlternates(routes.faq(), safeLocale)
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

export default async function FaqPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('faq')

  const generalItemKeys = [
    'whatIsFormoria',
    'listingVsSelection',
    'purchaseThroughFormoria',
    'taiwaneseBrandCriteria',
    'notListedBrands',
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

  return (
    <PageShell as="main" measure="page" className="py-10">
      <OpenTargetDetails />
      <div className="grid gap-10 md:grid-cols-5 md:gap-16">
        <aside className="space-y-4 md:sticky md:top-(--nav-height) md:self-start">
          <h1 id="faq-heading" className="type-section">
            {t('title')}
          </h1>
          <nav
            aria-label={t('sections.navigation')}
            className="space-y-1 border-l border-rule pl-3"
          >
            <a
              href="#general"
              className="flex min-h-12 items-center px-3 type-nav hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('sections.general')}
            </a>
            <a
              href="#for-owners"
              className="flex min-h-12 items-center px-3 type-nav hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('sections.forOwners')}
            </a>
          </nav>
          <p className="type-body-sm">
            {t.rich('intro', {
              contact: (chunks) => (
                <Link href={routes.contact()} className="type-nav font-semibold text-accent underline-offset-4 hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </aside>
        <div
          role="region"
          aria-labelledby="faq-heading"
          className="space-y-10 md:col-span-4"
        >
          <section id="general" className="scroll-mt-24">
            <div className="mb-4 border-b border-rule pb-3">
              <h2 className="type-card-title">{t('sections.general')}</h2>
            </div>
            <Accordion>
              {generalItemKeys.map((key) => (
                <AccordionItem
                  key={key}
                  className="scroll-mt-24"
                  title={t(`items.${key}.question`)}
                >
                  <p>{t(`items.${key}.answer`)}</p>
                </AccordionItem>
              ))}
              <AccordionItem title={t('items.contact.question')}>
                <p>
                  {t.rich('items.contact.answer', {
                    link: (chunks) => (
                      <Link href={routes.contact()} className="underline underline-offset-4">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              </AccordionItem>
            </Accordion>
          </section>
          <section id="for-owners" className="scroll-mt-24">
            <div className="mb-4 border-b border-rule pb-3">
              <h2 className="type-card-title">{t('sections.forOwners')}</h2>
            </div>
            <Accordion>
              {/* Brand claiming is live (`ClaimBrandCta` on the brand page), so
                  this answer describes the claim flow; the remaining owner
                  features have no public destination yet.
                  `id="claim"` is kept so legacy /faq#claim deep links still
                  land on an answer — and it must stay on the <details> itself,
                  which is what OpenTargetDetails looks for. */}
              <AccordionItem
                id="claim"
                className="scroll-mt-24"
                title={t('items.ownerInterest.question')}
              >
                <p>{t('items.ownerInterest.answer')}</p>
              </AccordionItem>
            </Accordion>
          </section>
        </div>
      </div>
    </PageShell>
  )
}
