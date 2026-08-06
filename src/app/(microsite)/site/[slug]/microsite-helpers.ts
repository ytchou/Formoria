import type { Metadata } from 'next'
import type { PublicMicrositeBrand } from '@/lib/brands/contracts'
import type { SiteContent } from '@/lib/types/brand'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'

export function isMicrositeEnabled(
  brand:
    | { status: PublicMicrositeBrand['status']; siteContent: SiteContent | null }
    | null
    | undefined,
): boolean {
  return !!brand && brand.status === 'approved' && !!brand.siteContent
}

export function micrositeMetadata(
  brand: Pick<PublicMicrositeBrand, 'name' | 'slug' | 'heroImageUrl'> & {
    description?: string | null
  },
): Metadata {
  const host = process.env.MICROSITE_HOST ?? 'brand.formoria.com'
  const url = `https://${host}/${brand.slug}`
  const description = truncateForMeta(brand.description ?? `${brand.name} 品牌微網站`)

  return {
    title: `${brand.name} | 品牌微網站`,
    description,
    alternates: { canonical: url },
    openGraph: {
      url,
      title: brand.name,
      description,
      type: 'website',
      images: brand.heroImageUrl ? [{ url: brand.heroImageUrl }] : undefined,
    },
    robots: { index: false, follow: true },
  }
}
