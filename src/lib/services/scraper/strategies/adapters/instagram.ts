import * as cheerio from 'cheerio'
import {
  emptyResult,
  extractGalleryImages,
  extractJsonLd,
  extractPurchaseLinks,
  extractSocialLinks,
  filterHeroImage,
} from '../../parse/extractors'
import type { PlatformAdapter } from './types'

function hostMatches(url: string, host: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === host || hostname.endsWith(`.${host}`)
  } catch {
    return false
  }
}

function metaContent($: cheerio.CheerioAPI, selector: string): string | null {
  return $(selector).attr('content')?.trim() || null
}

function cleanInstagramTitle(title: string | null): string | null {
  if (!title) return null

  const withoutSuffix = title.replace(/\s*•\s*Instagram.*$/i, '').trim()
  const usernameMatch = withoutSuffix.match(/^@?([A-Za-z0-9._]+)$/)

  return usernameMatch?.[1] ?? withoutSuffix
}

export const instagramAdapter: PlatformAdapter = {
  host: 'instagram.com',
  matches: (url) => hostMatches(url, 'instagram.com'),
  parse(html, url) {
    const $ = cheerio.load(html)
    const result = emptyResult(url)
    const rawJsonLd = extractJsonLd($)
    const galleryImageUrls = extractGalleryImages($, url)
    const { socialThreads, socialFacebook } = extractSocialLinks($)
    const { purchaseWebsite, purchasePinkoi, purchaseShopee } = extractPurchaseLinks($)
    const heroCandidate =
      metaContent($, 'meta[property="og:image"]') ||
      metaContent($, 'meta[name="twitter:image"]')

    return {
      ...result,
      brandName: cleanInstagramTitle(metaContent($, 'meta[property="og:title"]')),
      description:
        metaContent($, 'meta[property="og:description"]') ||
        metaContent($, 'meta[name="description"]'),
      heroImageUrl: heroCandidate
        ? filterHeroImage(heroCandidate, url) ?? galleryImageUrls[0] ?? null
        : galleryImageUrls[0] ?? null,
      galleryImageUrls,
      socialInstagram: url,
      socialThreads,
      socialFacebook,
      purchaseWebsite,
      purchasePinkoi,
      purchaseShopee,
      rawJsonLd,
    }
  },
}
