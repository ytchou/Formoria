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
} from '../parse/extractors'
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
      const { purchaseWebsite, purchasePinkoi, purchaseShopee } = extractPurchaseLinks($)

      return {
        brandName,
        description,
        story: null,
        heroImageUrl,
        galleryImageUrls,
        socialInstagram,
        socialThreads,
        socialFacebook,
        purchaseWebsite,
        purchasePinkoi,
        purchaseShopee,
        categoryHints: extractCategoryHints($),
        websiteUrl: url,
        rawJsonLd,
        stockistPageText: null,
        jsonLdImageUrls,
      }
    } catch {
      return emptyResult(url)
    }
  }
}
