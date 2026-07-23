export type {
  Brand,
  BrandFilters,
  BrandFlatLinkColumns,
  BrandStatus,
  OtherUrl,
  RetailLocation,
  RetailLocationRelationshipType,
  SubmissionStatus,
} from './brand'

export type {
  BrandChannel,
  BrandChannelInput,
  ChannelCandidate,
  ChannelConfirmedBy,
  ChannelSource,
  ChannelStatus,
  ChannelType,
  OwnerStatus,
} from './brand-channel'

export type {
  BrandSubmission,
  DenialReason,
  OwnerLocale,
  SourceAttribution,
  SubmissionIntent,
} from './submission'

export { DENIAL_REASONS, normalizeOwnerLocale } from './submission'
