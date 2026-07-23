export type ChannelStatus = 'confirmed' | 'unconfirmed'
export type ChannelConfirmedBy = 'owner' | 'community'
export type ChannelSource = 'backfill' | 'enriched' | 'community' | 'owner' | 'admin'
export type ChannelType = 'online' | 'offline'
export type OwnerStatus = 'none' | 'confirmed' | 'rejected'

export interface BrandChannel {
  id: string
  name: string
  channelType: ChannelType
  categoryLabel: string | null
  regionLabel: string | null
  address: string | null
  url: string | null
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
}

export interface BrandChannelInput {
  name: string
  channelType: ChannelType
  category?: string
  region?: string
  address?: string
  url?: string
}
