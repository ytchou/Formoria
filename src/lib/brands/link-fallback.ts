import type { Brand } from '@/lib/types'
import {
  ONLINE_STORES,
  type OnlineStoreCamelField,
  type OnlineStoreKey,
} from '@/lib/brands/online-stores'
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from '@/lib/url'

export type BrandVisitLinkFields = Pick<
  Brand,
  | OnlineStoreCamelField
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
>

export type BrandVisitLinkKind =
  | OnlineStoreKey
  | 'instagram'
  | 'threads'
  | 'facebook'

export interface BrandVisitLink {
  href: string
  kind: BrandVisitLinkKind
}

// Hostnames that override the winning field's own kind, so a marketplace URL
// stored in a different purchase field is still labelled by where it actually goes.
const HOST_KINDS: ReadonlyArray<readonly [BrandVisitLinkKind, readonly string[]]> = [
  ...ONLINE_STORES
    .filter((channel) => channel.hosts.length > 0)
    .map((channel) => [channel.key, channel.hosts] as const),
  ['instagram', ['instagram.com']],
  ['threads', ['threads.net', 'threads.com']],
  ['facebook', ['facebook.com', 'fb.com']],
]

function classifyHref(href: string, fallback: BrandVisitLinkKind): BrandVisitLinkKind {
  let hostname: string
  try {
    hostname = new URL(href).hostname.toLowerCase()
  } catch {
    return fallback
  }
  for (const [kind, hosts] of HOST_KINDS) {
    if (hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      return kind
    }
  }
  return fallback
}

export function getBrandVisitLink(brand: BrandVisitLinkFields): BrandVisitLink | null {
  const candidates: ReadonlyArray<readonly [BrandVisitLinkKind, string | null]> = [
    ...ONLINE_STORES.map((channel) => [
      channel.key,
      sanitizeHref(brand[channel.camel]),
    ] as const),
    ['instagram', normalizeInstagramHref(brand.socialInstagram)],
    ['threads', normalizeThreadsHref(brand.socialThreads)],
    ['facebook', sanitizeHref(brand.socialFacebook)],
  ]

  for (const [kind, href] of candidates) {
    if (href) {
      return { href, kind: classifyHref(href, kind) }
    }
  }

  return null
}
