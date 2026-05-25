import type { TaxonomyTag } from './taxonomy'
import type { BrandSortOption } from '@/lib/pagination'

export type BrandStatus = 'pending' | 'approved' | 'rejected' | 'hidden'

export type PurchaseLink = {
  platform: string
  url: string
  label: string
}

export type SocialLinks = {
  instagram?: string
  threads?: string
  facebook?: string
  officialWebsite?: string
}

export type RetailLocation = {
  name: string
  address: string
  latitude: number
  longitude: number
}

export type BrandFounder = {
  name: string
  title: string | null
  avatarUrl: string | null
  quote: string | null
}

export type Brand = {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  heroImageUrl: string | null
  status: BrandStatus
  category: string | null
  foundingYear: number | null
  purchaseLinks: PurchaseLink[]
  socialLinks: SocialLinks
  retailLocations: RetailLocation[]
  productPhotos: string[]
  contactEmail: string | null
  founder: BrandFounder | null
  brandHighlights: string | null
  tags: TaxonomyTag[]
  submittedAt: string
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type BrandFilters = {
  status?: BrandStatus
  category?: string
  search?: string
  tags?: string[]
  sort?: BrandSortOption
  limit?: number
  offset?: number
}
