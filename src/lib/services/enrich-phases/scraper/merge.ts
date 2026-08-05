import type { ScrapedBrandData } from '@/lib/types/scraper'
import { PURCHASE_CHANNELS, type PurchaseChannelCamelField } from '@/lib/brands/purchase-channels'
import type { InputType } from './strategies/types'

type ScrapeResult = { type: InputType; data: ScrapedBrandData }
type SocialLinkFields = Pick<
  ScrapedBrandData,
  'socialInstagram' | 'socialThreads' | 'socialFacebook'
>
type PurchaseLinkFields = Pick<
  ScrapedBrandData,
  PurchaseChannelCamelField
>

const MAX_CATEGORY_HINTS = 5

/**
 * Sanity bound on the concatenated gallery so a pathological page cannot grow
 * the pool without limit. It is not a quality lever — the real cap is the
 * vision classifier's top-10 selection downstream.
 */
export const MAX_MERGED_GALLERY_IMAGES = 60

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
    purchaseMyship: null,
    categoryHints: [],
    websiteUrl: '',
    rawJsonLd: null,
    stockistPageText: null,
    jsonLdImageUrls: [],
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

/**
 * Images are the one field where first-non-empty-wins is wrong. A brand is
 * scraped across several URLs — its official site, then its Instagram, Pinkoi
 * or Shopee page — and each runs a different platform adapter yielding a
 * different set of images, so a site returning two weak thumbnails would
 * suppress a 20-image Instagram gallery outright. Concatenating is safe because
 * downstream every candidate clears independent quality gates and is then
 * ranked by the vision classifier, which keeps only the top 10: a larger pool
 * strictly helps, the adapters cost no API credits, and provenance is recorded
 * per image so we can measure which method actually wins. Suppression, by
 * contrast, discards the better source silently.
 */
function appendGalleryImages(merged: ScrapedBrandData, data: ScrapedBrandData): void {
  if (!hasValue(data.galleryImageUrls)) return

  const seen = new Set(merged.galleryImageUrls)
  // Provenance travels with its image: a source is carried over only alongside
  // its URL, and is dropped with it when that URL is deduped away.
  const sourceByUrl = new Map(
    (data.imageSources ?? []).map((source) => [source.url, source] as const)
  )

  for (const url of data.galleryImageUrls) {
    if (merged.galleryImageUrls.length >= MAX_MERGED_GALLERY_IMAGES) break
    if (seen.has(url)) continue

    seen.add(url)
    merged.galleryImageUrls.push(url)

    const source = sourceByUrl.get(url)
    if (source) {
      merged.imageSources = [...(merged.imageSources ?? []), source]
    }
  }
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
  return Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [
      channel.camel,
      base[channel.camel] ?? next[channel.camel],
    ]),
  ) as PurchaseLinkFields
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
    // Gallery images (and their parallel provenance) accumulate across every
    // result instead of letting the first non-empty one win — see
    // `appendGalleryImages`. No other field changes semantics.
    appendGalleryImages(merged, data)
    if (!hasValue(merged.websiteUrl) && hasValue(data.websiteUrl)) {
      merged.websiteUrl = data.websiteUrl
    }
    if (!hasValue(merged.rawJsonLd) && hasValue(data.rawJsonLd)) {
      merged.rawJsonLd = data.rawJsonLd
    }
    if (!hasValue(merged.stockistPageText) && hasValue(data.stockistPageText)) {
      merged.stockistPageText = data.stockistPageText
    }
    // `hasValue`, not a bare `.length`: every other field here tolerates a
    // partial result, and this one used to throw on it. That was harmless while
    // the only caller passed strategy output (always a full `emptyResult`
    // spread), but the discovered-links second pass merges here too, so the
    // shapes reaching this loop are no longer all built the same way.
    if (hasValue(data.jsonLdImageUrls)) {
      const seen = new Set(merged.jsonLdImageUrls)
      for (const url of data.jsonLdImageUrls) {
        if (!seen.has(url)) {
          seen.add(url)
          merged.jsonLdImageUrls.push(url)
        }
      }
    }

    const socialLinks = mergeSocialLinks(merged, data)
    merged.socialInstagram = socialLinks.socialInstagram
    merged.socialThreads = socialLinks.socialThreads
    merged.socialFacebook = socialLinks.socialFacebook
    const purchaseLinks = mergePurchaseLinks(merged, data)
    merged.purchaseWebsite = purchaseLinks.purchaseWebsite
    merged.purchasePinkoi = purchaseLinks.purchasePinkoi
    merged.purchaseShopee = purchaseLinks.purchaseShopee
    merged.purchaseMyship = purchaseLinks.purchaseMyship
    merged.categoryHints = mergeCategoryHints(
      merged.categoryHints,
      data.categoryHints
    )
  }

  return merged
}
