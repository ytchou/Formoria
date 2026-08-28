import * as cheerio from 'cheerio'
import { fetchHtml } from '../fetch-guards'
import {
  emptyResult,
  extractAllJsonLd,
  extractCategoryHints,
  extractFavicons,
  extractGalleryImages,
  extractJsonLd,
  extractJsonLdImages,
  extractPurchaseLinks,
  extractSocialLinks,
  filterHeroImage,
  toImageSources,
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
      const purchaseLinks = extractPurchaseLinks($)
      const faviconUrls = await extractFavicons($, url)

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
        stockistPageText: null,
        jsonLdImageUrls,
        faviconUrls,
      }
    } catch {
      return emptyResult(url)
    }
  }
}
