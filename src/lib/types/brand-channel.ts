type ChannelStatus = 'confirmed' | 'unconfirmed'
/**
 * Who vouches for a confirmed channel. These are public trust claims, so each
 * one must be literally true: `owner` means the brand itself said so,
 * `formoria` means an admin approved a community submission the brand never
 * touched, `evidence` means a cited source backs it. Collapsing `formoria` into
 * `owner` would print 品牌確認 over a claim the brand never made.
 */
type ChannelConfirmedBy = 'owner' | 'formoria' | 'evidence'
/**
 * Which kind of evidence backs a `confirmedBy: 'evidence'` channel. The public
 * label differs by kind, so this must never be widened to a boolean: only
 * `official_website` may claim the brand's own site as the source.
 */
type ChannelEvidenceSource = 'official_website' | 'other'
export type ChannelSource =
  'backfill' | 'enriched' | 'community' | 'owner' | 'admin' | 'import'
type OwnerStatus = 'none' | 'confirmed' | 'rejected'

export type ChannelLocationType =
  | 'stockist'
  | 'distributor_retailer'
  | 'direct_store'
  | 'department_store_counter'
  | 'showroom_studio'
  | 'shop_in_shop'
  | 'other_physical_retail'

/**
 * A stockist: a physical place a brand's products can be found in.
 *
 * There is no online/offline discriminator any more (DEV-1513). Every row in
 * `brand_channels` was `offline`, and the online branch it gated only ever
 * suppressed a location label on rows that had none to print.
 */
export interface BrandChannel {
  id: string
  name: string
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
  status: ChannelStatus
  confirmedBy?: ChannelConfirmedBy
  evidenceSource?: ChannelEvidenceSource
}

export interface ChannelCandidate {
  name: string
  normalizedName: string
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
  region?: string
  address?: string
  url?: string
}
