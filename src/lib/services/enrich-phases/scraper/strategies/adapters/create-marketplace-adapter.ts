import * as cheerio from 'cheerio'
import {
  domBreadcrumbs,
  emptyResult,
  extractCategoryHints,
  extractGalleryImages,
  extractJsonLd,
  extractPurchaseLinks,
  extractSocialLinks,
  filterHeroImage,
  findStructuredStore,
  firstString,
  hostMatches,
  jsonLdBreadcrumbs,
  metaContent,
  textContent,
  unique,
  toImageSources,
} from '../../parse/extractors'
import type { PlatformAdapter } from './types'

// Marketplace adapter images are free — no API credit is spent — and measure
// higher quality than search results, so a wider pool just gives the ranker
// more to choose from. MAX_BRAND_ACTIVE_IMAGES downstream is the cap that
// actually binds; MAX_GALLERY_IMAGES stays the default for the generic path.
const MARKETPLACE_GALLERY_LIMIT = 20

export interface MarketplaceAdapterConfig {
  host: string
  titleSuffixPatterns: RegExp[]
  productImageExtractor: ($: cheerio.CheerioAPI, limit?: number) => string[]
  purchaseKey: 'purchasePinkoi' | 'purchaseShopee'
  /** Stable provenance slug recorded on every image this adapter yields. */
  imageMethod: string
  shopNameSelector: string
  shopDescriptionSelector: string
}

function cleanTitle(title: string | null, titleSuffixPatterns: RegExp[]): string | null {
  if (!title) return null

  const cleaned = titleSuffixPatterns.reduce((value, pattern) => value.replace(pattern, ''), title).trim()

  return cleaned || title
}

export function createMarketplaceAdapter(config: MarketplaceAdapterConfig): PlatformAdapter {
  return {
    host: config.host,
    matches: (url) => hostMatches(url, config.host),
    parse(html, url) {
      const $ = cheerio.load(html)
      const result = emptyResult(url)
      const rawJsonLd = extractJsonLd($)
      const structuredStore = findStructuredStore(rawJsonLd)
      const productImageUrls = config.productImageExtractor($, MARKETPLACE_GALLERY_LIMIT)
      const galleryImageUrls = [
        ...new Set([
          ...productImageUrls,
          ...extractGalleryImages($, url, { limit: MARKETPLACE_GALLERY_LIMIT }),
        ]),
      ].slice(0, MARKETPLACE_GALLERY_LIMIT)

      const brandName = cleanTitle(
        metaContent($, 'meta[property="og:title"]') ||
          firstString(structuredStore?.name) ||
          textContent($, 'h1') ||
          textContent($, config.shopNameSelector) ||
          textContent($, config.host === 'pinkoi.com' ? '[data-testid*="store"] h1' : '[data-testid*="shop"] h1'),
        config.titleSuffixPatterns
      )

      const description =
        metaContent($, 'meta[property="og:description"]') ||
        metaContent($, 'meta[name="description"]') ||
        firstString(structuredStore?.description) ||
        textContent($, config.host === 'pinkoi.com' ? '[class*="description"]' : config.shopDescriptionSelector) ||
        textContent($, config.host === 'pinkoi.com' ? '[class*="story"]' : '[class*="description"]')

      const heroCandidate =
        metaContent($, 'meta[property="og:image"]') ||
        metaContent($, 'meta[name="twitter:image"]') ||
        firstString(structuredStore?.image)

      return {
        ...result,
        brandName,
        description,
        story: description,
        heroImageUrl: heroCandidate
          ? filterHeroImage(heroCandidate, url) ?? galleryImageUrls[0] ?? null
          : galleryImageUrls[0] ?? null,
        galleryImageUrls,
        imageSources: toImageSources(galleryImageUrls, config.imageMethod, url),
        ...extractSocialLinks($),
        ...extractPurchaseLinks($),
        [config.purchaseKey]: url,
        categoryHints: unique([
          ...extractCategoryHints($),
          ...domBreadcrumbs($),
          ...jsonLdBreadcrumbs(rawJsonLd),
        ]),
        rawJsonLd,
      }
    },
  }
}
