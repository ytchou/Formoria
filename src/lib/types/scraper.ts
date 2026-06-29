export interface ScrapedBrandData {
  brandName: string | null
  description: string | null
  story: string | null
  heroImageUrl: string | null
  galleryImageUrls: string[]
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  categoryHints: string[]
  websiteUrl: string
  rawJsonLd: Record<string, unknown> | null
}
