import type { Metadata } from 'next'
import type { Brand } from '@/lib/types/brand'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'

export function isMicrositeEnabled(brand: Brand | null | undefined): boolean {
  return !!brand && brand.status === 'approved' && !!brand.siteContent
}

export function micrositeMetadata(brand: Brand): Metadata {
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
