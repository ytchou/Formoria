import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale, getMessages } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buildOrganizationJsonLd, buildWebSiteJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import HeroSection from '@/components/landing/hero-section'
import BrandShowcase from '@/components/shared/brand-showcase'
import FilterableBrandShowcase from '@/components/landing/filterable-brand-showcase'
import SectionBand from '@/components/landing/section-band'
import { getBrands, getNewBrands, getRecentBrandCount } from '@/lib/services/brands'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export const revalidate = 3600

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('landing.metadata')
  const { canonical, languages } = buildAlternates('/', safeLocale)

  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'

  return {
    title: { absolute: t('title') },
    description: t('description'),
    alternates: { canonical, languages },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
    openGraph: {
      title: t('title'),
      description: t('description'),
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
  }
}

export default async function LandingPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('landing')
  const jsonLd = buildWebSiteJsonLd(safeLocale)
  const organizationJsonLd = buildOrganizationJsonLd(safeLocale)

  const [{ brands: fetchedBrands, totalCount: totalBrandCount }, newBrands, recentBrands, messages] = await Promise.all([
    getBrands({ status: 'approved', limit: 60 }),
    getNewBrands(4),
    getRecentBrandCount(),
    getMessages(),
  ])

  const allBrands = shuffle(fetchedBrands)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(organizationJsonLd) }}
      />
      <main>
        <HeroSection brandCount={totalBrandCount} categoryCount={PRODUCT_TYPE_CATEGORIES.length} recentBrands={recentBrands} />

        <SavedBrandsProvider>
          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <NextIntlClientProvider messages={messages}>
                <FilterableBrandShowcase brands={allBrands} categories={[...PRODUCT_TYPE_CATEGORIES]} />
              </NextIntlClientProvider>
            </div>
          </div>

          {/* Manifesto pull-quote */}
          <section className="py-12 md:py-16">
            <div className="mx-auto max-w-4xl page-gutter text-center">
              <blockquote className="type-page-title-large text-foreground">
                {t('manifesto.headline')}
              </blockquote>
              <p className="mt-3 type-body-muted">{t('manifesto.body1')}</p>
              <Link href="/about" className="mt-4 inline-block type-body-emphasis text-primary hover:underline underline-offset-4">
                {t('manifesto.cta')}
              </Link>
            </div>
          </section>

          <div className="py-6 md:py-8">
            <div className="mx-auto max-w-6xl page-gutter">
              <BrandShowcase
                brands={newBrands}
                heading={t('newBrands.heading')}
                linkText={t('newBrands.linkText')}
                linkHref="/brands"
              />
            </div>
          </div>
        </SavedBrandsProvider>

        <SectionBand />
      </main>
    </>
  )
}
