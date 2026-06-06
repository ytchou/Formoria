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

export type MitEvidence = {
  mit_smile_listed?: boolean
  mit_smile_cert?: string
  verified_source?: string
  verified_by?: string
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
  isVerified: boolean
  mitStatus?: 'unverified' | 'claimed' | 'verified' | 'rejected'
  mitVerifiedAt?: string | null
  mitEvidence?: MitEvidence | null
  mitVerified?: boolean
  isDemo: boolean
  foundingYear: number | null
  purchaseLinks: PurchaseLink[]
  socialLinks: SocialLinks
  retailLocations: RetailLocation[]
  productPhotos: string[]
  contactEmail: string | null
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
  verificationFilter?: 'verified' | 'community' | 'all'
  search?: string
  tags?: string[]
  sort?: BrandSortOption
  limit?: number
  offset?: number
}
