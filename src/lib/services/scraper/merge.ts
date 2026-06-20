import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { InputType } from './strategies/types'

type ScrapeResult = { type: InputType; data: ScrapedBrandData }
type SocialLinkFields = Pick<
  ScrapedBrandData,
  'socialInstagram' | 'socialThreads' | 'socialFacebook'
>
type PurchaseLinkFields = Pick<
  ScrapedBrandData,
  'purchaseWebsite' | 'purchasePinkoi' | 'purchaseShopee'
>

const MAX_CATEGORY_HINTS = 5

const PRECEDENCE: Record<InputType, number> = {
  'official-site': 0,
  'deep-multi-page': 1,
  'e-commerce': 2,
  social: 3,
}

function hasValue<T>(value: T | null | undefined): value is T {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function emptyMergedResult(): ScrapedBrandData {
  return {
    brandName: null,
    description: null,
    story: null,
    heroImageUrl: null,
    galleryImageUrls: [],
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    categoryHints: [],
    websiteUrl: '',
    rawJsonLd: null,
  }
}

function mergeCategoryHints(base: string[], next: string[]): string[] {
  const seen = new Set(base)

  for (const hint of next) {
    if (seen.size >= MAX_CATEGORY_HINTS) break
    seen.add(hint)
  }

  return [...seen].slice(0, MAX_CATEGORY_HINTS)
}

export function mergeSocialLinks(
  base: SocialLinkFields,
  next: SocialLinkFields
): SocialLinkFields {
  return {
    socialInstagram: base.socialInstagram ?? next.socialInstagram,
    socialThreads: base.socialThreads ?? next.socialThreads,
    socialFacebook: base.socialFacebook ?? next.socialFacebook,
  }
}

export function mergePurchaseLinks(
  base: PurchaseLinkFields,
  next: PurchaseLinkFields
): PurchaseLinkFields {
  return {
    purchaseWebsite: base.purchaseWebsite ?? next.purchaseWebsite,
    purchasePinkoi: base.purchasePinkoi ?? next.purchasePinkoi,
    purchaseShopee: base.purchaseShopee ?? next.purchaseShopee,
  }
}

export function mergeScrapedData(results: ScrapeResult[]): ScrapedBrandData {
  const sortedResults = [...results].sort(
    (a, b) => PRECEDENCE[a.type] - PRECEDENCE[b.type]
  )
  const merged = emptyMergedResult()

  for (const { data } of sortedResults) {
    if (!hasValue(merged.brandName) && hasValue(data.brandName)) {
      merged.brandName = data.brandName
    }
    if (!hasValue(merged.description) && hasValue(data.description)) {
      merged.description = data.description
    }
    if (!hasValue(merged.story) && hasValue(data.story)) {
      merged.story = data.story
    }
    if (!hasValue(merged.heroImageUrl) && hasValue(data.heroImageUrl)) {
      merged.heroImageUrl = data.heroImageUrl
    }
    if (!hasValue(merged.galleryImageUrls) && hasValue(data.galleryImageUrls)) {
      merged.galleryImageUrls = data.galleryImageUrls
    }
    if (!hasValue(merged.websiteUrl) && hasValue(data.websiteUrl)) {
      merged.websiteUrl = data.websiteUrl
    }
    if (!hasValue(merged.rawJsonLd) && hasValue(data.rawJsonLd)) {
      merged.rawJsonLd = data.rawJsonLd
    }

    const socialLinks = mergeSocialLinks(merged, data)
    merged.socialInstagram = socialLinks.socialInstagram
    merged.socialThreads = socialLinks.socialThreads
    merged.socialFacebook = socialLinks.socialFacebook
    const purchaseLinks = mergePurchaseLinks(merged, data)
    merged.purchaseWebsite = purchaseLinks.purchaseWebsite
    merged.purchasePinkoi = purchaseLinks.purchasePinkoi
    merged.purchaseShopee = purchaseLinks.purchaseShopee
    merged.categoryHints = mergeCategoryHints(
      merged.categoryHints,
      data.categoryHints
    )
  }

  return merged
}
