type ChannelStatus = 'confirmed' | 'unconfirmed'
type ChannelConfirmedBy = 'owner' | 'community' | 'evidence'
/**
 * Which kind of evidence backs a `confirmedBy: 'evidence'` channel. The public
 * label differs by kind, so this must never be widened to a boolean: only
 * `official_website` may claim the brand's own site as the source.
 */
type ChannelEvidenceSource = 'official_website' | 'other'
export type ChannelSource =
  'backfill' | 'enriched' | 'community' | 'owner' | 'admin' | 'import'
export type ChannelType = 'online' | 'offline'
type OwnerStatus = 'none' | 'confirmed' | 'rejected'

export type ChannelLocationType =
  | 'stockist'
  | 'distributor_retailer'
  | 'direct_store'
  | 'department_store_counter'
  | 'showroom_studio'
  | 'shop_in_shop'
  | 'other_physical_retail'

export interface BrandChannel {
  id: string
  name: string
  channelType: ChannelType
  regionLabel: string | null
  address: string | null
  url: string | null
  // `sourceUrl` is deliberately absent: it is a server-side input used to derive
  // `confirmedBy` and `evidenceSource`, and no client surface renders it.
  fetchedAt?: string | null
  locationType?: ChannelLocationType | null
  country?: string | null
  ownerStatus: OwnerStatus
  source: ChannelSource
  confirmationCount: number
  status: ChannelStatus
  confirmedBy?: ChannelConfirmedBy
  evidenceSource?: ChannelEvidenceSource
  hasCurrentUserConfirmed?: boolean
}

export interface ChannelCandidate {
  name: string
  normalizedName: string
  channelType: ChannelType
  regionLabel?: string | null
  address?: string | null
  url?: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  locationType?: ChannelLocationType | null
  country?: string | null
  district?: string | null
  lastConfirmedAt?: string | null
  providerMetadata?: Record<string, unknown> | null
  source?: ChannelSource
}

export interface BrandChannelInput {
  name: string
  channelType: ChannelType
  region?: string
  address?: string
  url?: string
}
