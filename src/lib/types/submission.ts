import type { SocialLinks } from './brand'

export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export type BrandSubmission = {
  id: string
  brandId: string | null
  brandName: string
  submitterEmail: string
  submitterName: string | null
  description: string | null
  websiteUrl: string | null
  socialLinks: SocialLinks
  suggestedTags: string[]
  status: SubmissionStatus
  reviewerNotes: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  pdpaConsentAt: string | null
}

/** Form-level purchase link (no label field required) */
export type FormPurchaseLink = {
  platform: string
  url: string
}

/** Form-level social links (all strings, not optional) */
export type FormSocialLinks = {
  instagram: string
  threads: string
  facebook: string
  website: string
}

/** Form-level retail location */
export type FormRetailLocation = {
  name: string
  address: string
}
