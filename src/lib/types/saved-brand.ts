import type { BrandImageMeta } from '@/lib/types/brand'

export interface SavedBrand {
  brandId: string
  brandName: string
  brandSlug: string
  heroImageUrl: string | null
  /**
   * Metadata for the hero image ONLY — a saved card renders exactly one image,
   * so a full index-aligned `imageAlts` array would claim more than is carried.
   * Null when the hero has no matching `brand_images` row.
   *
   * Deliberately a whole `BrandImageMeta` rather than the flattened
   * `isLogo`/`focalX`/`focalY` triple it replaces: those names satisfied
   * `objectPositionStyle` only by coinciding with its structural parameter, so
   * nothing tied them to `BrandImageMeta` and a field added there would never
   * have reached this type.
   */
  heroImageMeta: BrandImageMeta | null
  savedAt: string
}
