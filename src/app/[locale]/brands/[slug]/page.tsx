import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  getBrandBySlug,
  getRelatedBrands,
  getBrandCountByCategory,
  getAllBrandSlugs,
  getBrandDraft,
  mergeDraftOverBrand,
} from '@/lib/services/brands'
import { hasPendingClaim } from '@/lib/services/claim-requests'
import { buildBrandJsonLd, buildBreadcrumbJsonLd } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import type { Brand } from '@/lib/types'
import { canManageBrand } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'
import { BrandViewTracker } from '@/components/brands/brand-view-tracker'
import { PreviewBanner } from '@/components/brands/preview-banner'
import { BrandAnalyticsTracker } from './brand-analytics-tracker'
import { BrandBreadcrumb } from '@/components/brands/brand-breadcrumb'
import { ImageCarousel } from '@/components/brands/image-carousel'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandActions } from '@/components/brands/brand-actions'
import { ClaimBrandCta } from '@/components/brands/claim-brand-cta'
import { RequestRemoval } from '@/components/brands/request-removal'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandTags } from '@/components/brands/brand-tags'
import { BrandHighlights } from '@/components/brands/brand-highlights'
import { BrandPhotoGallery } from '@/components/brands/brand-photo-gallery'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'
import { MoreInCategory } from '@/components/brands/more-in-category'
import { RelatedBrands } from '@/components/brands/related-brands'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

// 1h ISR: ownership/verified-state changes propagate within ~an hour; route still statically served between regenerations
export const revalidate = 3600

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
  searchParams: Promise<{ source?: string; preview?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('brandDetail')

  try {
    const brand = await getBrandBySlug(slug)
    const heroImageUrl = safeImageSrc(brand.heroImageUrl)
    const { canonical, languages } = buildAlternates(`/brands/${brand.slug}`, safeLocale)
    const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
    const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
    return {
      title: brand.name,
      description: brand.description ?? t('metadata.fallbackDescription', { name: brand.name }),
      alternates: { canonical, languages },
      openGraph: {
        title: brand.name,
        description: brand.description ?? undefined,
        images: heroImageUrl ? [{ url: heroImageUrl }] : undefined,
        locale: ogLocale,
        alternateLocale: [ogAlternateLocale],
      },
      twitter: {
        title: brand.name,
        description: brand.description ?? undefined,
        images: heroImageUrl ?? undefined,
      },
    }
  } catch {
    return { title: t('metadata.notFoundTitle') }
  }
}

export default async function BrandDetailPage({ params, searchParams }: PageProps) {
  const { locale, slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { source: sourceParam, preview } = await searchParams
  const previewRequested = preview === '1'

  if (previewRequested) {
    await connection()
  }

  const source = (
    sourceParam === 'search' ||
    sourceParam === 'category' ||
    sourceParam === 'directory' ||
    sourceParam === 'direct' ||
    sourceParam === 'recommendation'
  ) ? sourceParam : 'direct'

  let brand
  try {
    brand = await getBrandBySlug(slug)
  } catch {
    notFound()
  }

  let displayBrand: Brand = brand
  let previewMode = false
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null
  const getSupabase = async () => {
    supabase ??= await createClient()
    return supabase
  }

  if (previewRequested) {
    const {
      data: { user },
    } = await (await getSupabase()).auth.getUser()
    const allowed = !!user && await canManageBrand(user.id, user.email, brand.id)

    if (allowed) {
      displayBrand = mergeDraftOverBrand(brand, await getBrandDraft(brand.id))
      previewMode = true
    }
  }

  // Non-approved brands should 404
  if (!previewMode && brand.status !== 'approved') {
    notFound()
  }

  let userHasPendingClaim = false
  if (!displayBrand.isVerified) {
    const {
      data: { user },
    } = await (await getSupabase()).auth.getUser()
    userHasPendingClaim = user ? await hasPendingClaim(user.id, displayBrand.id) : false
  }

  // Gallery images: hero + product photos
  const galleryImages = [displayBrand.heroImageUrl, ...displayBrand.productPhotos].filter(
    (url): url is string => Boolean(url),
  )

  const productTypeSlug = (displayBrand as Brand & { product_type?: string | null }).product_type ?? null
  const productTypeCategory = PRODUCT_TYPE_CATEGORIES.find((category) => category.slug === productTypeSlug)
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
    categoryTag
      ? getBrandCountByCategory(categoryTag.slug, displayBrand.slug)
      : Promise.resolve(0),
  ])

  // Visit Website URL
  const visitUrl = displayBrand.purchaseWebsite || displayBrand.purchasePinkoi || displayBrand.purchaseShopee || null

  // Breadcrumb items for JSON-LD
  const tBrandDetail = await getTranslations('brandDetail')
  const directoryLabel = tBrandDetail('breadcrumb.directory')
  const categoryLabel = productTypeCategory?.nameZh ?? getBrandCategoryLabel(displayBrand)

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: directoryLabel, href: '/brands' },
    ...(categoryTag
      ? [{ label: categoryLabel || categoryTag.name, href: `/categories/${categoryTag.slug}` }]
      : []),
    { label: displayBrand.name },
  ]

  return (
    <>
      {previewMode && <PreviewBanner slug={slug} />}
      <main className="mx-auto max-w-screen-xl px-6 pt-10 pb-24 md:px-10 lg:pb-10">
        {!previewMode && (
          <>
            <BrandViewTracker brandSlug={slug} source={source} />
            <BrandAnalyticsTracker brandId={displayBrand.id} source={source} />
          </>
        )}
        {/* JSON-LD structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBrandJsonLd(displayBrand, safeLocale)) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems, safeLocale)) }}
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
              <ImageCarousel images={galleryImages} alt={displayBrand.name} />
            </div>
          </div>

          {/* Right: scrolling content */}
          <div className="min-w-0 flex-1 space-y-6">
            <BrandHeader
              brand={displayBrand}
              categoryLabel={categoryLabel || null}
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

            {!displayBrand.isVerified && (
              <ClaimBrandCta
                brandId={displayBrand.id}
                hasPendingClaim={userHasPendingClaim}
                removalSlot={<RequestRemoval brandName={displayBrand.name} brandSlug={displayBrand.slug} />}
              />
            )}

            <hr className="border-border" />

            <BrandAbout brand={displayBrand} />

            <hr className="border-border" />

            <BrandTags brand={displayBrand} />
            <BrandHighlights brand={displayBrand} />
            <BrandPhotoGallery photos={displayBrand.productPhotos} brandSlug={displayBrand.slug} />

            <hr className="border-border" />

            <BrandLinks brand={displayBrand} />
            <BrandLocations brand={displayBrand} />

            {categoryTag && (
              <MoreInCategory
                category={categoryTag.slug}
                categoryLabel={categoryLabel || null}
                count={categoryCount}
              />
            )}
          </div>
        </div>

        {/* Related brands */}
        {categoryTag && (
          <RelatedBrands
            brands={relatedBrands}
            categoryName={categoryLabel || categoryTag.name}
            categoryLabel={categoryLabel || null}
          />
        )}
      </main>
    </>
  )
}
