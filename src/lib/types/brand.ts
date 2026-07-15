import type { BrandSortOption } from '@/lib/pagination'

export type BrandStatus = 'approved' | 'hidden'
export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export type OtherUrl = {
  label: string
  url: string
}

interface ReputationSource {
  url: string
}

export interface ReputationSummary {
  text: string
  textEn?: string | null
  sources: ReputationSource[]
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

export type RetailLocationRelationshipType =
  | 'brand_store'
  | 'stockist'
  | 'department_counter'

export type RetailLocationType = 'chain' | 'independent'

export type RetailLocationVerificationStatus =
  | 'verified'
  | 'manual'
  | 'needs_review'

export type RetailLocation = {
  name: string
  relationshipType?: RetailLocationRelationshipType
  type?: RetailLocationType
  address: string
  city?: string
  district?: string
  venueName?: string
  floorOrCounter?: string
  availabilityNote?: string
  latitude?: number
  longitude?: number
  verificationStatus?: RetailLocationVerificationStatus
}

type MitEvidence = {
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
  descriptionEn: string | null
  blurb: string | null
  blurbEn: string | null
  heroImageUrl: string | null
  status: BrandStatus
  productType?: string | null
  city: string | null
  category: string | null
  isVerified: boolean
  mitStatus?: 'unverified' | 'verified'
  mitVerifiedAt?: string | null
  mitEvidence?: MitEvidence | null
  mitVerified?: boolean
  mitStory?: string | null
  isDemo: boolean
  foundingYear: number | null
  reputationSummary?: ReputationSummary | null
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  otherUrls: OtherUrl[]
  retailLocations: RetailLocation[]
  productPhotos: string[]
  imageAlts: Array<{ altZh: string | null; altEn: string | null }>
  contactEmail: string | null
  priceRange: number | null
  productTags: string[]
  productTagsEn: string[]
  siteContent: SiteContent | null
  submittedAt: string
  approvedAt: string | null
  createdAt: string
  updatedAt: string
}

export type BrandFilters = {
  status?: BrandStatus
  category?: string[]
  priceRanges?: (1 | 2 | 3)[]
  verificationFilter?: 'all' | 'mit-verified' | 'owned'
  search?: string
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
    | 'descriptionEn'
    | 'blurb'
    | 'heroImageUrl'
    | 'city'
    | 'category'
    | 'contactEmail'
    | 'priceRange'
    | 'productTags'
    | 'foundingYear'
    | 'socialInstagram'
    | 'socialThreads'
    | 'socialFacebook'
    | 'purchaseWebsite'
    | 'purchasePinkoi'
    | 'purchaseShopee'
    | 'otherUrls'
    | 'retailLocations'
    | 'productPhotos'
    | 'siteContent'
    | 'mitStory'
  >
}
