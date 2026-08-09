import type { BrandSortOption } from '@/lib/pagination'
import type {
  PurchaseChannelCamelField,
  PurchaseChannelColumn,
} from '@/lib/brands/purchase-channels'

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
  other_urls?: unknown
} & { [Column in PurchaseChannelColumn]?: string | null }

export type RetailLocationRelationshipType =
  | 'brand_store'
  | 'stockist'
  | 'department_counter'

export type RetailLocationType = 'chain' | 'independent'

export type RetailLocationVerificationStatus =
  | 'verified'
  | 'manual'
  | 'needs_review'

type RetailLocationConfirmationStatus =
  | 'unconfirmed'
  | 'owner_confirmed'

export type PhysicalRetailLocation = {
  kind: 'location'
  name: string
  relationshipType: RetailLocationRelationshipType
  /** @deprecated Legacy input only. Canonical rows use kind. */
  type?: RetailLocationType
  address?: string
  city?: string
  district?: string
  venueName?: string
  floorOrCounter?: string
  availabilityNote?: string
  latitude?: number
  longitude?: number
  verificationStatus?: RetailLocationVerificationStatus
  confirmationStatus: RetailLocationConfirmationStatus
  retailerUrl?: never
}

export type RetailChainChannel = {
  kind: 'retail_chain'
  name: string
  retailerUrl?: string
  availabilityNote?: string
  /** @deprecated Legacy input only. Canonical rows use kind. */
  type?: RetailLocationType
  relationshipType?: never
  address?: never
  city?: never
  district?: never
  venueName?: never
  floorOrCounter?: never
  latitude?: never
  longitude?: never
  verificationStatus?: never
  confirmationStatus?: never
}

export type RetailLocation = PhysicalRetailLocation | RetailChainChannel

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

/**
 * Per-image metadata, index-aligned with `[heroImageUrl, ...productPhotos]`.
 *
 * `isLogo` exists because fill mode is not a per-surface constant: a logo
 * carries its whitespace padding inside the asset, so `object-cover` crops the
 * mark itself, while a product photo letterboxed by `object-contain` is what
 * makes a grid of mixed aspect ratios read as ragged. The renderer cannot infer
 * this from the URL, so the classifier's tag has to travel with the image.
 *
 * `focalX`/`focalY` are the same idea one step further: `object-cover` crops
 * from the centre, which can cut the subject out of frame, so the measured
 * subject position travels with the image and becomes `object-position`. Both
 * are `null` for every image that has not been measured, which renders as the
 * centre — i.e. today's behavior.
 */
export type BrandImageMeta = {
  altZh: string | null
  altEn: string | null
  isLogo: boolean
  focalX: number | null
  focalY: number | null
}

export type Brand = {
  id: string
  name: string
  slug: string
  romanizedName?: string | null
  description: string | null
  descriptionEn: string | null
  blurb: string | null
  blurbEn: string | null
  heroImageUrl: string | null
  heroImageMetadata?: {
    altZh: string | null
    altEn: string | null
    width: number | null
    height: number | null
  } | null
  status: BrandStatus
  productType?: string | null
  city: string | null
  category: string | null
  isVerified: boolean
  mitStatus?: 'unverified' | 'declared' | 'verified'
  mitDeclaredScope?: 'all' | 'most' | 'some' | null
  mitDeclaredAt?: string | null
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
  otherUrls: OtherUrl[]
  productPhotos: string[]
  imageAlts: BrandImageMeta[]
  contactEmail: string | null
  priceRange: number | null
  productTags: string[]
  productTagsEn: string[]
  siteContent: SiteContent | null
  submittedAt: string
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  onboardingDismissedAt: string | null
} & { [Field in PurchaseChannelCamelField]: string | null }

export type BrandFilters = {
  status?: BrandStatus
  category?: string[]
  priceRanges?: (1 | 2 | 3)[]
  verificationFilter?: 'all' | 'mit-verified' | 'mit-declared' | 'owned'
  search?: string
  sort?: BrandSortOption
  limit?: number
  offset?: number
  includeTestBrands?: boolean
}
