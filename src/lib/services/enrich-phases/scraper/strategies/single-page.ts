import * as cheerio from 'cheerio'
import { fetchHtml } from '../fetch-guards'
import {
  emptyResult,
  extractAllJsonLd,
  extractCategoryHints,
  extractGalleryImages,
  extractJsonLd,
  extractJsonLdImages,
  extractPurchaseLinks,
  extractSocialLinks,
  filterHeroImage,
  toImageSources,
} from '../parse/extractors'
import { classifyCandidate, getPageText } from '../parse/page-kind'
import type { ScrapeContext, ScrapeStrategy } from './types'

function getMetaContent($: cheerio.CheerioAPI, selector: string): string | null {
  return $(selector).attr('content') || null
}

export class SinglePageStrategy implements ScrapeStrategy {
  readonly type = 'official-site'

  async scrape(url: string, ctx: ScrapeContext) {
    try {
      const html = ctx.prefetchedHtml ?? await fetchHtml(url)
      if (html == null) return emptyResult(url)

      const $ = cheerio.load(html)
      const rawJsonLd = extractJsonLd($)
      const allJsonLd = extractAllJsonLd($)
      const jsonLdImageUrls = extractJsonLdImages(allJsonLd, url)
      const galleryImageUrls = extractGalleryImages($, url)

      const brandName =
        getMetaContent($, 'meta[property="og:title"]') ||
        getMetaContent($, 'meta[name="twitter:title"]') ||
        $('title').text().trim() ||
        null

      const description =
        getMetaContent($, 'meta[property="og:description"]') ||
        getMetaContent($, 'meta[name="description"]') ||
        null

      const heroCandidate =
        getMetaContent($, 'meta[property="og:image"]') ||
        getMetaContent($, 'meta[name="twitter:image"]') ||
        (jsonLdImageUrls[0] ?? null)
      const heroImageUrl = heroCandidate
        ? filterHeroImage(heroCandidate, url) ?? galleryImageUrls[0] ?? null
        : galleryImageUrls[0] ?? null

      const { socialInstagram, socialThreads, socialFacebook } = extractSocialLinks($)
      const purchaseLinks = extractPurchaseLinks($)
      // A URL that is itself a store-locator page carries its own venue list
      // (DEV-1943). `getPageText` strips script nodes, JSON-LD included, so it
      // reads a fresh document rather than the one the extractors above used.
      const stockistPageText =
        classifyCandidate(url, '') === 'stockist' ? getPageText(cheerio.load(html)) : null
      return {
        brandName,
        description,
        story: null,
        heroImageUrl,
        galleryImageUrls,
        imageSources: toImageSources(galleryImageUrls, 'single_page', url),
        socialInstagram,
        socialThreads,
        socialFacebook,
        ...purchaseLinks,
        categoryHints: extractCategoryHints($),
        websiteUrl: url,
        rawJsonLd,
        stockistPageText,
        jsonLdImageUrls,
      }
    } catch {
      return emptyResult(url)
    }
  }
}
