import type { BrandSortOption } from '@/lib/pagination'
import type {
  OnlineStoreCamelField,
  OnlineStoreColumn,
} from '@/lib/brands/online-stores'

export type BrandStatus = 'approved' | 'hidden'
/** The `brands.mit_status` ladder. Mirrors the CHECK constraint in
 *  20260722100000_mit_status_ladder.sql — keep in lockstep. */
export type MitStatus = 'unverified' | 'declared' | 'verified'
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
} & { [Column in OnlineStoreColumn]?: string | null }

type MitEvidence = {
  mit_smile_listed?: boolean
  mit_smile_cert?: string
  notes?: string
  verified_source?: string
  verified_by?: string
}

/**
 * Per-image metadata, index-aligned with `[heroImageUrl, ...productPhotos]`.
 *
 * `isLogo` exists because fill mode is not a per-surface constant: a logo
 * carries its whitespace padding inside the asset, so `object-cover` crops the
 * mark itself, while a product photo letterboxed by `object-contain` is what
 * makes a grid of mixed aspect ratios read as ragged. The renderer cannot infer
 * this from the URL, so the classifier's tag has to travel with the image.
 */
export type BrandImageMeta = {
  altZh: string | null
  altEn: string | null
  isLogo: boolean
  /**
   * `brand_images.source === 'owner'` — the brand handed us this file through
   * the dashboard wizard. It is the ONLY rights signal on an image and the only
   * thing the brand-supplied credit may be derived from; every other source is
   * Formoria or a crawler.
   *
   * Optional because it is read on exactly one surface (the brand-detail
   * gallery) and most producers of this type have no `source` to report — a
   * required field would have forced ~20 fixtures and four service constructors
   * to state a provenance they do not know. Absent means "not stated", which
   * fails closed: no credit.
   */
  isOwnerSupplied?: boolean
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
  categorySlug?: string | null
  city: string | null
  categoryLabel: string | null
  isVerified: boolean
  mitStatus?: MitStatus
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
  subcategories: string[]
  subcategoriesEn: string[]
  /** Raw `brands.site_content` jsonb, passed through unshaped. */
  siteContent: unknown | null
  submittedAt: string
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  onboardingDismissedAt: string | null
} & { [Field in OnlineStoreCamelField]: string | null }

export type BrandFilters = {
  status?: BrandStatus
  category?: string[]
  /**
   * `brands.material` slugs, from the closed 12-slug vocabulary (`MATERIALS`).
   * An orthogonal axis to `category`: both the browse query and the search RPC
   * apply it, or `?material=` breaks the moment a user types (DEV-1510).
   */
  materials?: string[]
  verificationFilter?: 'all' | 'mit-verified' | 'mit-declared' | 'owned'
  search?: string
  sort?: BrandSortOption
  limit?: number
  offset?: number
  includeTestBrands?: boolean
}
