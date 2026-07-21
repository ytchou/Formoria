import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  getApprovedBrandBySlug,
  findBrandByOldSlug,
  getRelatedBrands,
  getBrandCountByCategory,
  getAllBrandSlugs,
} from '@/lib/services/brands'
import { buildBrandJsonLd, buildBreadcrumbJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import type { Brand } from '@/lib/types'
import { BrandViewTracker } from '@/components/brands/brand-view-tracker'
import { BrandAnalyticsTracker } from './brand-analytics-tracker'
import { BrandBreadcrumb } from '@/components/brands/brand-breadcrumb'
import { ImageCarousel } from '@/components/brands/image-carousel'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandActions } from '@/components/brands/brand-actions'
import { AdminBrandMenu } from '@/components/brands/admin-brand-menu'
import { ClaimBrandCta } from '@/components/brands/claim-brand-cta'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandFaqAccordion } from '@/components/brands/brand-faq-accordion'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'
import { RelatedBrands } from '@/components/brands/related-brands'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { getBrandVisitHref } from '@/lib/brands/link-fallback'
import { normalizeRetailLocations } from '@/lib/brands/locations'
import { getBrandFaq } from '@/lib/services/brand-faq'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { cn } from '@/lib/utils'
import { NotFoundError } from '@/lib/errors'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'
import { getBrandIndexability } from '@/lib/seo/brand-indexability'

// 1h ISR: ownership/verified-state changes propagate within ~an hour; route still statically served between regenerations
export const revalidate = 3600
export const dynamic = 'force-static'

export async function generateStaticParams() {
  try {
    const slugs = await getAllBrandSlugs()
    return slugs.map((slug) => ({ slug }))
  } catch {
    return []
  }
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
}

type BrandFaqTranslateFn = (key: string, params?: Record<string, unknown>) => string

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('brandDetail')

  try {
    const brand = await getApprovedBrandBySlug(slug)
    const indexability = getBrandIndexability(brand)
    const availableLocales: Locale[] = [
      ...(indexability['zh-TW'] ? (['zh-TW'] as const) : []),
      ...(indexability.en ? (['en'] as const) : []),
    ]
    const heroImageUrl = safeImageSrc(brand.heroImageUrl)
    const { canonical, languages } = buildAlternates(
      `/brands/${brand.slug}`,
      safeLocale,
      availableLocales,
    )
    const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
    const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
    const rawDescription =
      safeLocale === 'en'
        ? (brand.blurbEn ?? brand.descriptionEn ?? brand.blurb ?? brand.description)
        : (brand.blurb ?? brand.description)
    const description = truncateForMeta(
      rawDescription || t('metadata.fallbackDescription', { name: brand.name }),
    )
    return {
      title: brand.name,
      description,
      alternates: { canonical, languages },
      robots: indexability[safeLocale] ? undefined : { index: false, follow: true },
      openGraph: {
        title: brand.name,
        description,
        images: heroImageUrl ? [{ url: heroImageUrl }] : undefined,
        locale: ogLocale,
        alternateLocale: availableLocales.includes(safeLocale === 'en' ? 'zh-TW' : 'en')
          ? [ogAlternateLocale]
          : undefined,
      },
      twitter: {
        title: brand.name,
        description,
        images: heroImageUrl ?? undefined,
      },
    }
  } catch (error) {
    try {
      const redirectSlug = await findBrandByOldSlug(slug)
      if (redirectSlug) {
        permanentRedirect(`/${locale}/brands/${encodeURIComponent(redirectSlug)}`)
      }
    } catch {
      // Fall through to original error handling.
    }

    if (error instanceof NotFoundError) {
      notFound()
    }

    throw error
  }
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  let brand
  try {
    brand = await getApprovedBrandBySlug(slug)
  } catch (error) {
    try {
      const redirectSlug = await findBrandByOldSlug(slug)
      if (redirectSlug) {
        permanentRedirect(`/${locale}/brands/${encodeURIComponent(redirectSlug)}`)
      }
    } catch {
      // Fall through to original error handling.
    }

    if (error instanceof NotFoundError) {
      notFound()
    }

    throw error
  }

  const displayBrand: Brand = brand
  const [tBrandDetail, tCities] = await Promise.all([
    getTranslations('brandDetail'),
    getTranslations('cities'),
  ])
  const tBrandFaq = ((key: string, params?: Record<string, unknown>) =>
    tBrandDetail(key, params as never)) as BrandFaqTranslateFn
  const faqItems = await getBrandFaq(displayBrand.id, displayBrand, tBrandFaq, safeLocale)

  // Gallery images: hero + product photos
  const galleryImages = [displayBrand.heroImageUrl, ...displayBrand.productPhotos].filter(
    (url): url is string => Boolean(url),
  )

  const productTypeSlug =
    (displayBrand as Brand & { product_type?: string | null }).product_type ?? null
  const productTypeCategory = PRODUCT_TYPE_CATEGORIES.find(
    (category) => category.slug === productTypeSlug,
  )
  const categoryTag = productTypeCategory
    ? {
        slug: productTypeCategory.slug,
        name: productTypeCategory.name,
        nameZh: productTypeCategory.nameZh,
      }
    : null

  // Parallel fetch: related brands + category count by product_type slug.
  const [relatedBrands, categoryCount] = await Promise.all([
    categoryTag
      ? getRelatedBrands(categoryTag.slug, displayBrand.slug, 4)
      : Promise.resolve<Brand[]>([]),
    categoryTag ? getBrandCountByCategory(categoryTag.slug, displayBrand.slug) : Promise.resolve(0),
  ])

  const visitUrl = getBrandVisitHref(displayBrand)

  // Breadcrumb items for JSON-LD
  const directoryLabel = tBrandDetail('breadcrumb.directory')
  const categoryLabel = productTypeCategory
    ? safeLocale === 'en'
      ? productTypeCategory.name
      : productTypeCategory.nameZh
    : getBrandCategoryLabel(displayBrand, safeLocale === 'en' ? 'en' : 'zh-TW')
  const hasRetailLocations = normalizeRetailLocations(displayBrand.retailLocations).length > 0

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: directoryLabel, href: '/brands' },
    ...(categoryTag
      ? [
          {
            label: categoryLabel || categoryTag.name,
            href: `/brands?category=${categoryTag.slug}`,
          },
        ]
      : []),
    { label: displayBrand.name },
  ]

  return (
    <>
      <main
        className={cn(
          'page-gutter mx-auto max-w-screen-xl pt-10 lg:pb-10',
          visitUrl ? 'pb-24' : 'pb-10',
        )}
      >
        <BrandViewTracker brandId={displayBrand.id} brandSlug={slug} />
        <BrandAnalyticsTracker brandId={displayBrand.id} />
        {/* JSON-LD structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(buildBrandJsonLd(displayBrand, safeLocale)),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(buildBreadcrumbJsonLd(breadcrumbItems, safeLocale)),
          }}
        />
        {/* Breadcrumb */}
        <BrandBreadcrumb
          categorySlug={categoryTag?.slug ?? null}
          categoryLabel={categoryLabel || null}
          brandName={displayBrand.name}
        />

        {/* Two-column layout */}
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
          {/* Left: sticky image gallery */}
          <div className="w-full lg:w-[580px] lg:shrink-0">
            <div className="lg:sticky lg:top-8">
              <ImageCarousel
                images={galleryImages}
                alt={displayBrand.name}
                brandId={displayBrand.id}
                brandSlug={displayBrand.slug}
                category={productTypeSlug}
                imageAlts={displayBrand.imageAlts}
              />
            </div>
          </div>

          {/* Right: scrolling content */}
          <div className="min-w-0 flex-1 space-y-6">
            <BrandHeader
              brand={displayBrand}
              categoryLabel={categoryLabel || null}
              cityLabel={displayBrand.city ? tCities(displayBrand.city) : null}
              locale={safeLocale}
              adminSlot={<AdminBrandMenu brandSlug={displayBrand.slug} />}
              actionsSlot={
                <SavedBrandsProvider>
                  <BrandActions
                    websiteUrl={visitUrl ?? null}
                    brandSlug={displayBrand.slug}
                    brandId={displayBrand.id}
                    brandName={displayBrand.name}
                  />
                </SavedBrandsProvider>
              }
            />

            <hr className="border-border" />

            <BrandAbout brand={displayBrand} />

            <hr className="border-border" />

            <BrandLinks brand={displayBrand} />

            {hasRetailLocations && (
              <>
                <hr className="border-border" />
                <BrandLocations brand={displayBrand} />
              </>
            )}

            {faqItems.length > 0 && (
              <>
                <hr className="border-border" />
                <BrandFaqAccordion items={faqItems} brandSlug={displayBrand.slug} />
              </>
            )}

            {!displayBrand.isVerified && (
              <ClaimBrandCta brandId={displayBrand.id} brandSlug={displayBrand.slug} />
            )}
          </div>
        </div>

        {/* Related brands */}
        {categoryTag && (
          <RelatedBrands
            brands={relatedBrands}
            category={categoryTag.slug}
            categoryName={categoryLabel || categoryTag.name}
            categoryLabel={categoryLabel || null}
            count={categoryCount}
            currentBrandSlug={displayBrand.slug}
          />
        )}
      </main>
    </>
  )
}
