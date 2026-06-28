import type { TaxonomyTag } from './taxonomy'
import type { BrandSortOption } from '@/lib/pagination'

export type BrandStatus = 'approved' | 'hidden'
export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export type OtherUrl = {
  label: string
  url: string
}

export type BrandFlatLinkColumns = {
  social_instagram?: string | null
  social_threads?: string | null
  social_facebook?: string | null
  purchase_website?: string | null
  purchase_pinkoi?: string | null
  purchase_shopee?: string | null
  other_urls?: unknown
}

export type RetailLocation = {
  name: string
  address: string
  latitude: number
  longitude: number
}

export type CustomerVoice = {
  author: string
  content: string
  source?: string
}

export type MitEvidence = {
  mit_smile_listed?: boolean
  mit_smile_cert?: string
  notes?: string
  verified_source?: string
  verified_by?: string
}

export type SiteTokens = {
  accent: string
  accentForeground?: string
}

export type SiteProduct = {
  name: string
  imageUrl?: string
  url?: string
  caption?: string
}

export type SiteContent = {
  template: string
  tokens: SiteTokens
  tagline?: string
  story?: string
  products: SiteProduct[]
  ctaType: 'mailto'
  ctaValue?: string
}

export type Brand = {
  id: string
  name: string
  slug: string
  description: string | null
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
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  otherUrls: OtherUrl[]
  retailLocations: RetailLocation[]
  customerVoices: CustomerVoice[]
  productPhotos: string[]
  contactEmail: string | null
  brandHighlights: string | null
  siteContent: SiteContent | null
  tags: TaxonomyTag[]
  submittedAt: string
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type BrandFilters = {
  status?: BrandStatus
  category?: string[]
  verificationFilter?: 'all' | 'mit-verified' | 'owned'
  search?: string
  tags?: string[]
  sort?: BrandSortOption
  limit?: number
  offset?: number
  includeTestBrands?: boolean
}

export type PendingBrandEdit = {
  id: string
  brandId: string
  submittedBy: string
  proposedData: Record<string, unknown>
  status: SubmissionStatus
  reviewerNotes: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  createdAt: string
  updatedAt: string
}

export type PendingBrandEditWithBrand = PendingBrandEdit & {
  brand: Pick<
    Brand,
    | 'id'
    | 'name'
    | 'slug'
    | 'description'
    | 'heroImageUrl'
    | 'category'
    | 'contactEmail'
    | 'brandHighlights'
    | 'foundingYear'
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
    | 'otherUrls'
    | 'retailLocations'
    | 'customerVoices'
    | 'productPhotos'
    | 'siteContent'
  >
}
