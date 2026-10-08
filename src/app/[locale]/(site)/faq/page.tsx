import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { Link } from '@/i18n/navigation'
import { PageShell } from '@/components/ui/page-shell'
import { routes } from '@/lib/routes'
import { visibleCategoryList } from '@/lib/taxonomy/category-list'

// Bounds the edge copy to an hour under the Cloudflare HTML cache rule
// (DEV-1961); without it Next sends s-maxage=31536000.
export const revalidate = 3600

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

  const { count, categories } = visibleCategoryList(locale)

  // Three topical groups instead of one: a single "general" bucket made the
  // nav a one-item list. Every key under `faq.items` renders exactly once
  // across these groups; the e2e count is derived from the catalogue.
  const sections = [
    {
      key: 'listing',
      itemKeys: [
        'whatIsFormoria',
        'listingVsSelection',
        'taiwaneseBrandCriteria',
        'notListedBrands',
        'whatCategories',
        'madeInTaiwanBadge',
      ],
    },
    {
      key: 'review',
      itemKeys: [
        'howToSubmit',
        'reviewTime',
        'isBrandFree',
        'dataAccuracy',
      ],
    },
    {
      key: 'more',
      itemKeys: ['purchaseThroughFormoria', 'languageSupport'],
    },
  ] as const

  return (
    <PageShell as="main" measure="page" className="py-10">
      <div className="grid gap-10 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-16">
        <aside className="space-y-4 md:sticky md:top-(--nav-height) md:self-start">
          <h1 id="faq-heading" className="type-section">
            {t('title')}
          </h1>
          <nav
            aria-label={t('sections.navigation')}
            className="space-y-1 border-l border-rule pl-3"
          >
            {sections.map(({ key }) => (
              <a
                key={key}
                href={`#${key}`}
                className="flex min-h-12 items-center px-3 type-nav hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t(`sections.${key}`)}
              </a>
            ))}
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
          className="space-y-10"
        >
          {sections.map(({ key, itemKeys }) => (
            <section key={key} id={key} className="scroll-mt-24">
              <h2 className="mb-3 type-card-title">{t(`sections.${key}`)}</h2>
              {/* An open definition list, never a collapsed panel: an answer
                  to a question ships visible in the server HTML (DESIGN.md
                  §7). Same markup as the brand-page FAQ
                  (`brand-faq-accordion.tsx`), so the site has one FAQ
                  pattern. */}
              <dl className="space-y-stack">
                {itemKeys.map((itemKey) => (
                  <div key={itemKey}>
                    <dt className="type-body font-semibold text-ink">
                      {t(`items.${itemKey}.question`)}
                    </dt>
                    <dd className="mt-2 type-body">
                      {itemKey === 'whatCategories'
                        ? t('items.whatCategories.answer', { count, categories })
                        : t(`items.${itemKey}.answer`)}
                    </dd>
                  </div>
                ))}
                {key === 'more' && (
                  <div>
                    <dt className="type-body font-semibold text-ink">
                      {t('items.contact.question')}
                    </dt>
                    <dd className="mt-2 type-body">
                      {t.rich('items.contact.answer', {
                        link: (chunks) => (
                          <Link href={routes.contact()} className="underline underline-offset-4">
                            {chunks}
                          </Link>
                        ),
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
