import type { Brand } from '@/lib/types'
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from '@/lib/url'

type BrandVisitLinkFields = Pick<
  Brand,
  | 'purchaseWebsite'
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchasePinkoi'
  | 'purchaseShopee'
>

export function getBrandVisitHref(brand: BrandVisitLinkFields): string | null {
  return (
    sanitizeHref(brand.purchaseWebsite) ||
    sanitizeHref(brand.purchasePinkoi) ||
    sanitizeHref(brand.purchaseShopee) ||
    normalizeInstagramHref(brand.socialInstagram) ||
    normalizeThreadsHref(brand.socialThreads) ||
    sanitizeHref(brand.socialFacebook) ||
    null
  )
}
