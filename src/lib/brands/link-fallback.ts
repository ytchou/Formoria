import type { Brand } from '@/lib/types'
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from '@/lib/url'

export type BrandVisitLinkFields = Pick<
  Brand,
  | 'purchaseWebsite'
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchasePinkoi'
  | 'purchaseShopee'
>

export type BrandVisitLinkKind =
  | 'website'
  | 'pinkoi'
  | 'shopee'
  | 'instagram'
  | 'threads'
  | 'facebook'

export interface BrandVisitLink {
  href: string
  kind: BrandVisitLinkKind
}

// Hostnames that override the winning field's own kind, so a marketplace URL
// stored in purchase_website is still labelled by where it actually goes.
const HOST_KINDS: ReadonlyArray<readonly [BrandVisitLinkKind, readonly string[]]> = [
  ['pinkoi', ['pinkoi.com']],
  ['shopee', ['shopee.tw', 'shopee.com.tw']],
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
    ['website', sanitizeHref(brand.purchaseWebsite)],
    ['pinkoi', sanitizeHref(brand.purchasePinkoi)],
    ['shopee', sanitizeHref(brand.purchaseShopee)],
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
