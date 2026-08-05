import type { LinkField } from '@/lib/types/link-fields'

/**
 * Provenance for one scraped image. `brand_images.source` says only 'scrape'
 * for Instagram, Pinkoi, Shopee, single-page and crawl alike, which makes
 * "which method produced this image" unanswerable after the fact.
 */
export interface ScrapedImageSource {
  url: string
  /** Stable slug, e.g. 'instagram_adapter' | 'single_page' | 'crawl' */
  method: string
  pageUrl: string
  /** Index within that page's gallery */
  position: number
}

export interface ScrapedBrandData {
  brandName: string | null
  description: string | null
  story: string | null
  heroImageUrl: string | null
  galleryImageUrls: string[]
  /** Parallel to `galleryImageUrls`; additive, consumers may ignore it. */
  imageSources?: ScrapedImageSource[]
  /** Which scraped page supplied each winning link value. Additive; consumers may ignore it. */
  linkProvenance?: Partial<Record<LinkField, { sourceUrl: string }>>
  /** The page whose text supplied `description` (and `story`). */
  textSourceUrl?: string
  /** Which scraped page supplied each winning text field. Additive; consumers may ignore it. */
  textProvenance?: Partial<Record<'brandName' | 'description' | 'story', { sourceUrl: string }>>
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  purchaseMyship: string | null
  categoryHints: string[]
  websiteUrl: string
  rawJsonLd: Record<string, unknown> | null
  stockistPageText: string | null
  jsonLdImageUrls: string[]
}
