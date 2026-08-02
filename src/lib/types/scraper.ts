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
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  categoryHints: string[]
  websiteUrl: string
  rawJsonLd: Record<string, unknown> | null
  stockistPageText: string | null
  jsonLdImageUrls: string[]
}
