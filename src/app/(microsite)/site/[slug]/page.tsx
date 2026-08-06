import { cache, createElement } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublicMicrositeBrandBySlug, getMicrositeSlugs } from '@/lib/services/brands'
import type { PublicMicrositeBrand } from '@/lib/brands/contracts'
import { getTemplate } from '@/components/microsite/templates/registry'
import { isMicrositeEnabled, micrositeMetadata } from './microsite-helpers'

// 1h ISR, matching every other public route. Microsite content is written by the
// admin enrichment/approval pipeline, not by owners editing live, so a sub-hour
// window buys nothing. If owner-facing live editing ever lands, add an on-demand
// `revalidatePath('/site/<slug>')` to that mutation instead of lowering this.
export const revalidate = 3600
export const dynamicParams = true

export async function generateStaticParams() {
  try {
    const slugs = await getMicrositeSlugs()
    return slugs.map((slug) => ({ slug }))
  } catch {
    return []
  }
}

type PageProps = {
  params: Promise<{ slug: string }>
}

// Memoized per request: `generateMetadata` and the page body both need the brand,
// and each `getBrandBySlug` costs a `brands` select plus a `brand_images` select.
const loadMicrositeBrand = cache(async (slug: string): Promise<PublicMicrositeBrand | null> => {
  try {
    return await getPublicMicrositeBrandBySlug(slug)
  } catch {
    return null
  }
})

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params

  const brand = await loadMicrositeBrand(slug)
  if (!isMicrositeEnabled(brand) || !brand) return {}
  return micrositeMetadata(brand)
}

export default async function MicrositePage({ params }: PageProps) {
  const { slug } = await params

  const brand = await loadMicrositeBrand(slug)

  if (!brand || !isMicrositeEnabled(brand) || !brand.siteContent) {
    notFound()
  }

  const siteContent = brand.siteContent
  const Template = getTemplate(siteContent.template)

  return createElement(Template, { brand, siteContent })
}
