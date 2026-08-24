import type { OtherUrl, SubmissionStatus } from './brand'
import type { OnlineStoreCamelField } from '@/lib/brands/online-stores'

type ValidationStatus = 'valid' | 'incomplete'
export type SubmissionIntent = 'recommend' | 'owner_claim' | 'refresh'
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
  | 'admin_reject'
  | 'other'

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
  'admin_reject',
  'other',
] as const satisfies readonly DenialReason[]

export type BrandSubmission = {
  id: string
  brandId: string | null
  intent?: SubmissionIntent
  brandName: string
  heroImageUrl?: string | null
  submitterEmail: string
  submitterName: string | null
  description: string | null
  socialInstagram: string | null
  socialThreads: string | null
  socialFacebook: string | null
  otherUrls: OtherUrl[]
  suggestedSubcategories: string[] | { values?: string[]; categorySlug?: string }
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
} & { [Field in OnlineStoreCamelField]: string | null }

export type DuplicateCandidate = {
  id: string
  name: string
  slug: string
  similarity: number
  matchedOn: 'name' | 'cjk' | 'latin' | 'website'
}

export type DuplicateCheckResult = {
  nameMatches: DuplicateCandidate[]
  websiteMatches: DuplicateCandidate[]
}
