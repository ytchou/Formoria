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
  MAX_GALLERY_IMAGES,
} from '../../parse/extractors'
import type { PlatformAdapter } from './types'

export interface MarketplaceAdapterConfig {
  host: string
  titleSuffixPatterns: RegExp[]
  productImageExtractor: ($: cheerio.CheerioAPI) => string[]
  purchaseKey: 'purchasePinkoi' | 'purchaseShopee'
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
      const productImageUrls = config.productImageExtractor($)
      const galleryImageUrls = [...new Set([...productImageUrls, ...extractGalleryImages($, url)])].slice(0, MAX_GALLERY_IMAGES)

      const brandName = cleanTitle(
        metaContent($, 'meta[property="og:title"]') ||
          firstString(structuredStore?.name) ||
          textContent($, 'h1') ||
          textContent($, config.shopNameSelector),
        config.titleSuffixPatterns
      )

      const description =
        metaContent($, 'meta[property="og:description"]') ||
        metaContent($, 'meta[name="description"]') ||
        firstString(structuredStore?.description) ||
        textContent($, config.shopDescriptionSelector) ||
        textContent($, '[class*="description"]')

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
