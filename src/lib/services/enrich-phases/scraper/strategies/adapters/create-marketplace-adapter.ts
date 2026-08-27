import * as cheerio from 'cheerio'
import type { OnlineStoreCamelField } from '@/lib/brands/online-stores'
import {
  domBreadcrumbs,
  emptyResult,
  extractCategoryHints,
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
  upgradeEcommerceImageUrl,
} from '../../parse/extractors'
import type { PlatformAdapter } from './types'
import type { PlatformId } from '../../platforms'

// Marketplace adapter images are free — no API credit is spent — and measure
// higher quality than search results, so a wider pool just gives the ranker
// more to choose from. MAX_BRAND_ACTIVE_IMAGES downstream is the cap that
// actually binds; MAX_GALLERY_IMAGES stays the default for the generic path.
const MARKETPLACE_GALLERY_LIMIT = 20

export interface MarketplaceAdapterConfig {
  host: string
  titleSuffixPatterns: RegExp[]
  productImageExtractor: (
    $: cheerio.CheerioAPI,
    pageUrl: string,
    limit?: number,
  ) => string[]
  purchaseKey: OnlineStoreCamelField
  /** Stable provenance slug recorded on every image this adapter yields. */
  imageMethod: string
  platform?: PlatformId
  /**
   * First name fallback, tried after og:title / JSON-LD name / `<h1>`.
   * Historically the class-based storefront heading selector.
   */
  shopNameSelector?: string
  /** Second name fallback, tried last. Historically the data-testid heading. */
  fallbackNameSelector?: string
  fallbackDescriptionSelectors?: string[]
  /**
   * Extra predicate ANDed with the host check. Used by MyShip, whose host also
   * serves landing and help pages that must not be parsed as storefronts.
   */
  matchesPath?: (url: string) => boolean
}

function cleanTitle(
  title: string | null,
  titleSuffixPatterns: RegExp[],
): string | null {
  if (!title) return null

  const cleaned = titleSuffixPatterns
    .reduce((value, pattern) => value.replace(pattern, ''), title)
    .trim()

  return cleaned || title
}

export function createMarketplaceAdapter(
  config: MarketplaceAdapterConfig,
): PlatformAdapter {
  return {
    host: config.host,
    platform: config.platform,
    matches: (url) =>
      hostMatches(url, config.host) && (config.matchesPath?.(url) ?? true),
    parse(html, url) {
      const $ = cheerio.load(html)
      const result = emptyResult(url)
      const rawJsonLd = extractJsonLd($)
      const structuredStore = findStructuredStore(rawJsonLd)
      const productImageUrls = config.productImageExtractor(
        $,
        url,
        MARKETPLACE_GALLERY_LIMIT,
      )
      const galleryImageUrls = [...new Set(productImageUrls)]
        .map(upgradeEcommerceImageUrl)
        .slice(0, MARKETPLACE_GALLERY_LIMIT)

      const brandName = cleanTitle(
        metaContent($, 'meta[property="og:title"]') ||
          firstString(structuredStore?.name) ||
          textContent($, 'h1') ||
          textContent($, config.shopNameSelector ?? '[class*="shop-name"]') ||
          textContent(
            $,
            config.fallbackNameSelector ?? '[data-testid*="shop"] h1',
          ),
        config.titleSuffixPatterns,
      )

      const fallbackDescription =
        (
          config.fallbackDescriptionSelectors ?? [
            '[class*="shop-description"]',
            '[class*="description"]',
          ]
        )
          .map((selector) => textContent($, selector))
          .find((value): value is string => Boolean(value)) ?? null
      const description =
        metaContent($, 'meta[property="og:description"]') ||
        metaContent($, 'meta[name="description"]') ||
        firstString(structuredStore?.description) ||
        fallbackDescription

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
          ? (filterHeroImage(heroCandidate, url) ??
            galleryImageUrls.at(0) ??
            null)
          : (galleryImageUrls.at(0) ?? null),
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
