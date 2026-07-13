import type { Metadata } from 'next'
import Image from 'next/image'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale, getMessages } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { buildOrganizationJsonLd, buildWebSiteJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import HeroSection from '@/components/landing/hero-section'
import BrandShowcase from '@/components/shared/brand-showcase'
import SectionBand from '@/components/landing/section-band'
import {
  EXPLORE_BRAND_LIMIT,
  getExploreBrands,
  getNewBrands,
  getRecentBrandCount,
} from '@/lib/services/brands'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export const revalidate = 3600

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

  const [{ brands: exploreBrands, totalCount: totalBrandCount }, newBrands, recentBrands, messages] = await Promise.all([
    getExploreBrands(EXPLORE_BRAND_LIMIT),
    getNewBrands(4),
    getRecentBrandCount(),
    getMessages(),
  ])

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
                <BrandShowcase
                  brands={exploreBrands}
                  heading={t('showcase.heading')}
                  linkText={t('showcase.browseAll')}
                  linkHref="/brands"
                />
              </NextIntlClientProvider>
            </div>
          </div>

          {/* Manifesto pull-quote */}
          <section className="relative overflow-hidden py-12 md:py-16">
            <Image
              src="/images/manifesto-bg.png"
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-background/70" aria-hidden="true" />
            <div className="relative mx-auto max-w-4xl page-gutter text-center">
              <blockquote className="type-page-title-large text-foreground">
                {t('manifesto.headline')}
              </blockquote>
              <p className="mt-3 type-body-muted">{t('manifesto.body1')}</p>
              <Link href="/about" className={buttonVariants({ variant: 'primary', tone: 'cta', className: 'mt-4' })}>
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
