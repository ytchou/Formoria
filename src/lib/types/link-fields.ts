import type { BrandFlatLinkColumns } from './brand'
import {
  ONLINE_STORE_CAMEL_FIELDS,
  ONLINE_STORES,
  type OnlineStoreCamelField,
  type OnlineStoreColumn,
} from '@/lib/brands/online-stores'

// Socials stay listed here — they have no registry. The purchase half is spliced
// in from `ONLINE_STORES`, preserving the existing field order.
export const LINK_FIELDS = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
  ...ONLINE_STORE_CAMEL_FIELDS,
] as const

export type LinkField = (typeof LINK_FIELDS)[number]
export type LinkColumn = Exclude<keyof BrandFlatLinkColumns, 'other_urls'>

export const LINK_FIELD_TO_COLUMN: Record<LinkField, LinkColumn> = {
  socialInstagram: 'social_instagram',
  socialThreads: 'social_threads',
  socialFacebook: 'social_facebook',
  ...(Object.fromEntries(
    ONLINE_STORES.map((channel) => [channel.camel, channel.column])
  ) as Record<OnlineStoreCamelField, OnlineStoreColumn>),
}
