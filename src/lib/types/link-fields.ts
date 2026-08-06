import type { BrandFlatLinkColumns } from './brand'
import {
  PURCHASE_CAMEL_FIELDS,
  PURCHASE_CHANNELS,
  type PurchaseChannelCamelField,
  type PurchaseChannelColumn,
} from '@/lib/brands/purchase-channels'

// Socials stay listed here — they have no registry. The purchase half is spliced
// in from `PURCHASE_CHANNELS`, preserving the existing field order.
export const LINK_FIELDS = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  ...PURCHASE_CAMEL_FIELDS,
] as const

export type LinkField = (typeof LINK_FIELDS)[number]
export type LinkColumn = Exclude<keyof BrandFlatLinkColumns, 'other_urls'>

export const LINK_FIELD_TO_COLUMN: Record<LinkField, LinkColumn> = {
  socialInstagram: 'social_instagram',
  socialThreads: 'social_threads',
  socialFacebook: 'social_facebook',
  ...(Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [channel.camel, channel.column])
  ) as Record<PurchaseChannelCamelField, PurchaseChannelColumn>),
}
