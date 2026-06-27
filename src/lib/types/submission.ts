import type { OtherUrl, SubmissionStatus } from './brand'

export type ValidationStatus = 'valid' | 'incomplete'
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
  suggestedTags: string[] | { region?: string; values?: string[] }
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
  unifiedBusinessNumber?: string
}

/** Form-level purchase link fields */
export type FormPurchaseLink = {
  purchaseWebsite: string
  purchasePinkoi: string
  purchaseShopee: string
  otherUrls: OtherUrl[]
}

/** Form-level social link fields */
export type FormSocialLinks = {
  socialInstagram: string
  socialThreads: string
  socialFacebook: string
}

/** Form-level retail location */
export type FormRetailLocation = {
  name: string
  address: string
}

export type DuplicateCandidate = {
  id: string
  name: string
  slug: string
  similarity: number
}

export type DuplicateCheckResult = {
  ubnMatch: { id: string; name: string; slug: string } | null
  nameMatches: DuplicateCandidate[]
}
