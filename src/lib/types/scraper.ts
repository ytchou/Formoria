export interface ScrapedBrandData {
  brandName: string | null
  description: string | null
  brandHighlights: string | null
  heroImageUrl: string | null
  galleryImageUrls: string[]
  socialLinks: {
    instagram: string | null
    threads: string | null
    facebook: string | null
  }
  categoryHints: string[]
  websiteUrl: string
  rawJsonLd: Record<string, unknown> | null
}

export interface PhotoItem {
  id: string
  url: string
  source: 'scraped' | 'uploaded'
}
