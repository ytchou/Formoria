import type { Metadata } from 'next'
import { getTranslations, getMessages, setRequestLocale } from 'next-intl/server'
import { buildDefinedTermSetJsonLd, buildBreadcrumbJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { MitVerifiedBadge, OwnerVerifiedBadge } from '@/components/brands/brand-verification-badges'
import { GlossaryAnchorNav } from './glossary-anchor-nav'

export const revalidate = 3600

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('glossary.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates('/glossary', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

type TermData = {
  zh: string
  en: string
  definition: string
  badge?: string
  range?: string
}

type SectionData = {
  title: string
  terms: Record<string, TermData>
}

type GlossaryMessages = {
  glossary: {
    metadata: { title: string; description: string }
    eyebrow: string
    heading: string
    lede: string
    sections: Record<string, SectionData>
  }
}

const SECTION_ORDER = ['core', 'verification', 'materials', 'priceRange', 'values'] as const
const ANCHOR_IDS: Record<string, string> = {
  core: 'core',
  verification: 'verification',
  materials: 'materials',
  priceRange: 'price-range',
  values: 'values',
}

export default async function GlossaryPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('glossary')
  const messages = (await getMessages()) as unknown as GlossaryMessages

  const sections = messages.glossary.sections

  // Flatten all terms for DefinedTermSet JSON-LD
  const allTerms = SECTION_ORDER.flatMap((sectionKey) => {
    const section = sections[sectionKey]
    if (!section) return []
    return Object.values(section.terms).map((term) => ({
      name: safeLocale === 'zh-TW' ? term.zh : term.en,
      description: term.definition,
    }))
  })

  const definedTermSetJsonLd = buildDefinedTermSetJsonLd(allTerms, safeLocale)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      { label: safeLocale === 'zh-TW' ? '首頁' : 'Home', href: '/' },
      { label: safeLocale === 'zh-TW' ? '名詞解說' : 'Glossary', href: '/glossary' },
    ],
    safeLocale,
  )

  const navSections = SECTION_ORDER.map((key) => ({
    id: ANCHOR_IDS[key],
    label: sections[key]?.title ?? key,
  }))

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(definedTermSetJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(breadcrumbJsonLd) }}
      />
      <main>
        <div className="max-w-6xl mx-auto px-4 py-12 sm:px-6 md:py-16">
          {/* Page intro */}
          <div className="mb-10 max-w-[680px]">
            <p className="mb-3 font-sans text-[13px] font-semibold uppercase tracking-widest text-primary">
              {t('eyebrow')}
            </p>
            <h1 className="font-heading text-[32px] font-bold leading-tight text-foreground md:text-[48px]">
              {t('heading')}
            </h1>
            <p className="mt-4 font-sans text-base leading-[1.7] text-muted-foreground">
              {t('lede')}
            </p>
          </div>
          <div className="mb-10 h-px w-full bg-border" />

          {/* Body: two-column on desktop */}
          <div className="flex flex-col gap-10 md:flex-row md:gap-12">
            <GlossaryAnchorNav
              sections={navSections}
              sectionsLabel={safeLocale === 'zh-TW' ? '分類' : 'SECTIONS'}
            />

            {/* Content */}
            <div className="flex-1 min-w-0">
              {SECTION_ORDER.map((sectionKey) => {
                const section = sections[sectionKey]
                if (!section) return null
                const anchorId = ANCHOR_IDS[sectionKey]
                const headingId = `section-heading-${anchorId}`
                const terms = Object.entries(section.terms)

                return (
                  <section
                    key={sectionKey}
                    id={anchorId}
                    aria-labelledby={headingId}
                    className="border-t border-border pb-12 pt-8"
                  >
                    {/* Section header */}
                    <div className="mb-6 flex items-center gap-3">
                      <div
                        aria-hidden
                        className="h-7 w-[3px] rounded-sm bg-primary"
                      />
                      <h2
                        id={headingId}
                        className="font-heading text-[22px] font-bold text-foreground"
                      >
                        {section.title}
                      </h2>
                    </div>

                    {/* Terms */}
                    <dl>
                      {terms.map(([termKey, term]) => (
                        <div
                          key={termKey}
                          className="border-t border-border py-6 first:border-t-0"
                        >
                          <dt className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="font-heading text-[18px] font-bold text-foreground">
                              {term.zh}
                              <span className="mx-1.5 font-sans text-sm font-normal text-muted-foreground">·</span>
                              {term.en}
                            </span>
                            {term.badge === 'verified' && (
                              <MitVerifiedBadge
                                label={safeLocale === 'zh-TW' ? 'MIT 已驗證' : 'MIT Verified'}
                                title={safeLocale === 'zh-TW' ? '已通過 MIT 微笑標章登錄驗證' : 'Verified MIT Smile Mark registration'}
                              />
                            )}
                            {term.badge === 'owner' && (
                              <OwnerVerifiedBadge
                                label={safeLocale === 'zh-TW' ? '品牌經營' : 'Brand-managed'}
                                title={safeLocale === 'zh-TW' ? '由品牌方經營管理' : 'Managed by the brand owner'}
                              />
                            )}
                            {term.range && (
                              <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 font-sans text-[12px] font-medium text-muted-foreground">
                                {term.range}
                              </span>
                            )}
                          </dt>
                          <dd className="font-sans text-[15px] leading-relaxed text-muted-foreground">
                            {term.definition}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
