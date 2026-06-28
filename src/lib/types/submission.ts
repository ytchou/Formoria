import type { OtherUrl, SubmissionStatus } from './brand'

type ValidationStatus = 'valid' | 'incomplete'
export type SourceAttribution =
  | 'bought_product'
  | 'saw_at_market'
  | 'found_online'
  | 'friend_recommended'
  | 'work_there'
export type DenialReason =
  | 'not_mit'
  | 'insufficient_info'
  | 'duplicate'
  | 'policy_violation'
  | 'other'
export type OwnerLocale = 'zh-TW' | 'en'

export const SOURCE_ATTRIBUTION_VALUES = [
  'bought_product',
  'saw_at_market',
  'found_online',
  'friend_recommended',
  'work_there',
] as const satisfies readonly SourceAttribution[]

export const DENIAL_REASONS = [
  'not_mit',
  'insufficient_info',
  'duplicate',
  'policy_violation',
  'other',
] as const satisfies readonly DenialReason[]

export function normalizeOwnerLocale(locale: unknown): OwnerLocale {
  return locale === 'en' ? 'en' : 'zh-TW'
}

export type BrandSubmission = {
  id: string
  brandId: string | null
  brandName: string
  heroImageUrl?: string | null
  productPhotos?: string[]
  submitterEmail: string
  submitterName: string | null
  description: string | null
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
  otherUrls: OtherUrl[]
  suggestedTags: string[] | { values?: string[] }
  status: SubmissionStatus
  reviewerNotes: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  pdpaConsentAt: string | null
  validationStatus: ValidationStatus | null
  validationErrors: string[] | null
  notifiedAt: string | null
  isBrandOwner: boolean
  sourceAttribution?: SourceAttribution | null
  denialReason?: DenialReason | null
}

type DuplicateCandidate = {
  id: string
  name: string
  slug: string
  similarity: number
}

export type DuplicateCheckResult = {
  nameMatches: DuplicateCandidate[]
}
