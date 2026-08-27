import type { ScrapedBrandData } from '@/lib/types/scraper'
import { ONLINE_STORES, type OnlineStoreCamelField } from '@/lib/brands/online-stores'
import { LINK_FIELDS, pageKey, type LinkField } from '@/lib/services/link-enrichment'
import type { InputType } from './strategies/types'

export type ScrapeResult = { type: InputType; data: ScrapedBrandData; sourceUrl?: string }
type SocialLinkFields = Pick<
  ScrapedBrandData,
  'socialInstagram' | 'socialThreads' | 'socialFacebook'
>
type PurchaseLinkFields = Pick<
  ScrapedBrandData,
  OnlineStoreCamelField
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
    faviconUrls: [],
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

// Retained for the flat-output scraper test and its public helper contract; the
// main merge path now handles all registered link fields in one provenance loop.
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
    ONLINE_STORES.map((channel) => [
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
  const linkProvenance: Partial<Record<LinkField, { sourceUrl: string }>> = {}
  const textProvenance: NonNullable<ScrapedBrandData['textProvenance']> = {}
  // Normalize keys so alternate spellings of one page share evidence. A Map
  // keeps externally-derived URL keys (e.g. `__proto__`) out of an object's
  // prototype chain; it is materialized into a plain object on assignment.
  const perSourceText = new Map<
    string,
    NonNullable<ScrapedBrandData['perSourceText']>[string]
  >()
  let descriptionSupplied = false
  let textSourceUrl: string | undefined

  const addSourceText = (
    sourceUrl: string,
    text: NonNullable<ScrapedBrandData['perSourceText']>[string],
  ): void => {
    const key = pageKey(sourceUrl)
    const existing = perSourceText.get(key) ?? {}
    for (const field of ['title', 'description', 'story'] as const) {
      const value = text[field]
      if (value === undefined) continue
      if (existing[field] === undefined) {
        existing[field] = value
      }
    }
    if (Object.keys(existing).length > 0) perSourceText.set(key, existing)
  }

  const addResultText = (data: ScrapedBrandData, sourceUrl?: string): void => {
    if (sourceUrl) {
      const text = {
        ...(hasValue(data.brandName) ? { title: data.brandName } : {}),
        ...(hasValue(data.description)
          ? { description: data.description }
          : {}),
        ...(hasValue(data.story) ? { story: data.story } : {}),
      }
      if (Object.keys(text).length > 0) addSourceText(sourceUrl, text)
      return
    }

    for (const [inheritedUrl, text] of Object.entries(data.perSourceText ?? {})) {
      addSourceText(inheritedUrl, text)
    }
  }

  for (const { data, sourceUrl } of sortedResults) {
    addResultText(data, sourceUrl)
    if (!hasValue(merged.brandName) && hasValue(data.brandName)) {
      merged.brandName = data.brandName
      const inherited = sourceUrl ?? data.textProvenance?.brandName?.sourceUrl
      if (inherited) textProvenance.brandName = { sourceUrl: inherited }
    }
    if (!hasValue(merged.description) && hasValue(data.description)) {
      merged.description = data.description
      descriptionSupplied = true
      const inherited =
        sourceUrl ?? data.textProvenance?.description?.sourceUrl ?? data.textSourceUrl
      if (inherited) textProvenance.description = { sourceUrl: inherited }
      textSourceUrl = inherited
    }
    if (!hasValue(merged.story) && hasValue(data.story)) {
      merged.story = data.story
      const inherited = sourceUrl ?? data.textProvenance?.story?.sourceUrl ?? data.textSourceUrl
      if (inherited) textProvenance.story = { sourceUrl: inherited }
      if (!descriptionSupplied) textSourceUrl = inherited
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

    // Link provenance records the result page that first supplied each value;
    // it is bookkeeping only and deliberately makes no identity judgment.
    for (const field of LINK_FIELDS) {
      const wasEmpty = merged[field] == null
      merged[field] ??= data[field]
      if (wasEmpty && hasValue(data[field])) {
        const inherited = sourceUrl ?? data.linkProvenance?.[field]?.sourceUrl
        if (inherited) linkProvenance[field] = { sourceUrl: inherited }
      }
    }
    merged.categoryHints = mergeCategoryHints(
      merged.categoryHints,
      data.categoryHints
    )
  }

  if (Object.keys(linkProvenance).length > 0) merged.linkProvenance = linkProvenance
  if (Object.keys(textProvenance).length > 0) merged.textProvenance = textProvenance
  if (perSourceText.size > 0) {
    merged.perSourceText = Object.fromEntries(perSourceText)
  }
  if (textSourceUrl) merged.textSourceUrl = textSourceUrl

  return merged
}
