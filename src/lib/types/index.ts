export type {
  Brand,
  BrandFilters,
  BrandFlatLinkColumns,
  BrandStatus,
  OtherUrl,
  RetailLocation,
  RetailLocationRelationshipType,
  RetailLocationVerificationStatus,
  SubmissionStatus,
} from './brand'

export type {
  BrandSubmission,
  DenialReason,
  OwnerLocale,
  SourceAttribution,
  SubmissionIntent,
} from './submission'

export { DENIAL_REASONS, normalizeOwnerLocale } from './submission'
