import type { BrandImageMeta } from '@/lib/types/brand'

export interface SavedBrand {
  brandId: string
  brandName: string
  brandSlug: string
  heroImageUrl: string | null
  /**
   * The image list and metadata share the same index alignment as
   * `[heroImageUrl, ...productPhotos]`, allowing the card to choose a product
   * photo without losing its fill mode.
   */
  productPhotos: string[]
  imageAlts: BrandImageMeta[]
  /** Kept for callers that only need the denormalized hero's metadata. */
  heroImageMeta: BrandImageMeta | null
  savedAt: string
}
