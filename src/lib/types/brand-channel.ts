type ChannelStatus = 'confirmed' | 'unconfirmed'
type ChannelConfirmedBy = 'owner' | 'community' | 'evidence'
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
  categoryLabel: string | null
  regionLabel: string | null
  address: string | null
  url: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  locationType?: ChannelLocationType | null
  country?: string | null
  ownerStatus: OwnerStatus
  source: ChannelSource
  confirmationCount: number
  status: ChannelStatus
  confirmedBy?: ChannelConfirmedBy
  hasCurrentUserConfirmed?: boolean
}

export interface ChannelCandidate {
  name: string
  normalizedName: string
  channelType: ChannelType
  categoryLabel?: string | null
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
  category?: string
  region?: string
  address?: string
  url?: string
}
