import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getBrandBySlug, getRelatedBrands, getAllBrandSlugs } from '@/lib/services/brands'
import { buildBrandJsonLd, buildBreadcrumbJsonLd } from '@/lib/json-ld'
import type { BreadcrumbItem } from '@/lib/json-ld'
import { BrandViewTracker } from '@/components/brands/brand-view-tracker'
import { BrandBreadcrumb } from '@/components/brands/brand-breadcrumb'
import { ImageCarousel } from '@/components/brands/image-carousel'
import { BrandHeader } from '@/components/brands/brand-header'
import { BrandActions } from '@/components/brands/brand-actions'
import { BrandAbout } from '@/components/brands/brand-about'
import { BrandFounder } from '@/components/brands/brand-founder'
import { BrandTags } from '@/components/brands/brand-tags'
import { BrandProductHighlights } from '@/components/brands/brand-product-highlights'
import { BrandPhotoGallery } from '@/components/brands/brand-photo-gallery'
import { BrandLinks } from '@/components/brands/brand-links'
import { BrandLocations } from '@/components/brands/brand-locations'
import { RelatedBrands } from '@/components/brands/related-brands'
import { buttonVariants } from '@/components/ui/button'

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

type PageProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params

  try {
    const brand = await getBrandBySlug(slug)
    return {
      title: `${brand.name} — MIT Map`,
      description: brand.description ?? `Discover ${brand.name}, a Made in Taiwan brand.`,
      openGraph: {
        title: brand.name,
        description: brand.description ?? undefined,
        images: brand.heroImageUrl ? [{ url: brand.heroImageUrl }] : undefined,
      },
    }
  } catch {
    return { title: 'Brand Not Found — MIT Map' }
  }
}

export default async function BrandDetailPage({ params }: PageProps) {
  const { slug } = await params

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

  // Related brands
  const relatedBrands = brand.category
    ? await getRelatedBrands(brand.category, brand.slug, 4)
    : []

  // Visit Website URL
  const visitUrl = brand.socialLinks.officialWebsite ?? brand.purchaseLinks[0]?.url

  // Breadcrumb items for JSON-LD
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Home', href: '/' },
    ...(brand.category
      ? [{ label: brand.category, href: `/?category=${encodeURIComponent(brand.category)}` }]
      : []),
    { label: brand.name },
  ]

  return (
    <main className="mx-auto max-w-screen-xl px-6 py-10 md:px-10">
      <BrandViewTracker brandSlug={slug} />
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
        <div className="min-w-0 flex-1 space-y-8">
          <BrandHeader brand={brand} />

          {/* Visit Website CTA */}
          {visitUrl && (
            <Link
              href={visitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'default', size: 'lg' }) + ' w-full'}
            >
              Visit Website
            </Link>
          )}

          <BrandActions />
          <BrandAbout brand={brand} />
          <BrandFounder brand={brand} />
          <BrandTags brand={brand} />
          <BrandProductHighlights brand={brand} />
          <BrandPhotoGallery photos={brand.productPhotos} brandSlug={brand.slug} />
          <BrandLinks brand={brand} />
          <BrandLocations brand={brand} />
        </div>
      </div>

      {/* Related brands */}
      {brand.category && (
        <RelatedBrands brands={relatedBrands} categoryName={brand.category} />
      )}
    </main>
  )
}
