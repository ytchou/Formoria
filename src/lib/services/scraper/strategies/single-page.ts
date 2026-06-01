import * as cheerio from 'cheerio'
import { fetchHtml } from '../fetch-guards'
import {
  emptyResult,
  extractCategoryHints,
  extractGalleryImages,
  extractJsonLd,
  extractSocialLinks,
  filterHeroImage,
} from '../parse/extractors'
import type { ScrapeContext, ScrapeStrategy } from './types'

function getMetaContent($: cheerio.CheerioAPI, selector: string): string | null {
  return $(selector).attr('content') || null
}

function getJsonLdImage(rawJsonLd: Record<string, unknown> | null): string | null {
  if (!rawJsonLd) return null

  return typeof rawJsonLd.image === 'string' ? rawJsonLd.image : null
}

export class SinglePageStrategy implements ScrapeStrategy {
  readonly type = 'official-site'

  async scrape(url: string, ctx: ScrapeContext) {
    try {
      const html = ctx.prefetchedHtml ?? await fetchHtml(url)
      if (html == null) return emptyResult(url)

      const $ = cheerio.load(html)
      const rawJsonLd = extractJsonLd($)
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
        getJsonLdImage(rawJsonLd)
      const heroImageUrl = heroCandidate
        ? filterHeroImage(heroCandidate, url) ?? galleryImageUrls[0] ?? null
        : galleryImageUrls[0] ?? null

      return {
        brandName,
        description,
        story: null,
        heroImageUrl,
        galleryImageUrls,
        socialLinks: extractSocialLinks($),
        categoryHints: extractCategoryHints($),
        websiteUrl: url,
        rawJsonLd,
      }
    } catch {
      return emptyResult(url)
    }
  }
}
