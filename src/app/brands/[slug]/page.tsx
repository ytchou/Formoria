import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getBrandBySlug, getRelatedBrands, getBrandCountByCategory, getAllBrandSlugs } from '@/lib/services/brands'
import { buildBrandJsonLd, buildBreadcrumbJsonLd } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { BrandViewTracker } from '@/components/brands/brand-view-tracker'
import { BrandAnalyticsTracker } from './brand-analytics-tracker'
import { BrandBreadcrumb } from '@/components/brands/brand-breadcrumb'
import { ImageCarousel } from '@/components/brands/image-carousel'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandActions } from '@/components/brands/brand-actions'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandTags } from '@/components/brands/brand-tags'
import { BrandHighlights } from '@/components/brands/brand-highlights'
import { BrandPhotoGallery } from '@/components/brands/brand-photo-gallery'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'
import { MoreInCategory } from '@/components/brands/more-in-category'
import { RelatedBrands } from '@/components/brands/related-brands'

// ISR: revalidate every hour
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
  params: Promise<{ slug: string }>
  searchParams: Promise<{ source?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params

  try {
    const brand = await getBrandBySlug(slug)
    return {
      title: brand.name,
      description: brand.description ?? `探索 ${brand.name}，台灣製造品牌。`,
      alternates: { canonical: `/brands/${brand.slug}` },
      openGraph: {
        title: brand.name,
        description: brand.description ?? undefined,
        images: brand.heroImageUrl ? [{ url: brand.heroImageUrl }] : undefined,
      },
      twitter: {
        title: brand.name,
        description: brand.description ?? undefined,
        images: brand.heroImageUrl ? [brand.heroImageUrl] : undefined,
      },
    }
  } catch {
    return { title: '找不到品牌' }
  }
}

export default async function BrandDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { source: sourceParam } = await searchParams
  const source = (
    sourceParam === 'search' ||
    sourceParam === 'category' ||
    sourceParam === 'direct' ||
    sourceParam === 'recommendation'
  ) ? sourceParam : 'direct'

  let brand
  try {
    brand = await getBrandBySlug(slug)
  } catch {
    notFound()
  }

  // Non-approved brands should 404
  if (brand.status !== 'approved') {
    notFound()
  }

  // Gallery images: hero + product photos
  const galleryImages = [brand.heroImageUrl, ...brand.productPhotos].filter(
    (url): url is string => Boolean(url),
  )

  // Parallel fetch: related brands + category count
  const [relatedBrands, categoryCount] = brand.category
    ? await Promise.all([
        getRelatedBrands(brand.category, brand.slug, 4),
        getBrandCountByCategory(brand.category, brand.slug),
      ])
    : [[], 0]

  // Visit Website URL
  const visitUrl = brand.socialLinks.officialWebsite ?? brand.purchaseLinks[0]?.url

  // Breadcrumb items for JSON-LD
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Brands', href: '/brands' },
    ...(brand.category
      ? [{ label: brand.category, href: `/brands?category=${encodeURIComponent(brand.category)}` }]
      : []),
    { label: brand.name },
  ]

  return (
    <main className="mx-auto max-w-screen-xl px-6 pt-10 pb-24 md:px-10 lg:pb-10">
      <BrandViewTracker brandSlug={slug} source={source} />
      <BrandAnalyticsTracker brandId={brand.id} />
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBrandJsonLd(brand)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />

      {/* Breadcrumb */}
      <BrandBreadcrumb category={brand.category} brandName={brand.name} />

      {/* Two-column layout */}
      <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
        {/* Left: sticky image gallery */}
        <div className="w-full lg:w-[580px] lg:shrink-0">
          <div className="lg:sticky lg:top-8">
            <ImageCarousel images={galleryImages} alt={brand.name} />
          </div>
        </div>

        {/* Right: scrolling content */}
        <div className="min-w-0 flex-1 space-y-6">
          <BrandHeader
            brand={brand}
            actionsSlot={<BrandActions websiteUrl={visitUrl ?? null} brandSlug={brand.slug} brandId={brand.id} />}
          />

          <hr className="border-border" />

          <BrandAbout brand={brand} />

          <hr className="border-border" />

          <BrandTags brand={brand} />
          <BrandHighlights brand={brand} />
          <BrandPhotoGallery photos={brand.productPhotos} brandSlug={brand.slug} />

          <hr className="border-border" />

          <BrandLinks brand={brand} />
          <BrandLocations brand={brand} />

          {brand.category && (
            <MoreInCategory category={brand.category} count={categoryCount} />
          )}
        </div>
      </div>

      {/* Related brands */}
      {brand.category && (
        <RelatedBrands brands={relatedBrands} categoryName={brand.category} />
      )}
    </main>
  )
}
