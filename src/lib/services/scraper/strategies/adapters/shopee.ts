import * as cheerio from 'cheerio'
import {
  emptyResult,
  extractCategoryHints,
  extractGalleryImages,
  extractJsonLd,
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

function textContent($: cheerio.CheerioAPI, selector: string): string | null {
  const text = $(selector).first().text().replace(/\s+/g, ' ').trim()
  return text || null
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstString(item)
      if (candidate) return candidate
    }
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return firstString(object.url) || firstString(object['@id'])
  }

  return null
}

function findStructuredStore(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredStore(item)
      if (found) return found
    }
    return null
  }

  if (!value || typeof value !== 'object') return null

  const object = value as Record<string, unknown>
  const type = object['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some((item) => item === 'Organization' || item === 'Store')) {
    return object
  }

  return findStructuredStore(object['@graph'])
}

function jsonLdBreadcrumbs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(jsonLdBreadcrumbs)
  }

  if (!value || typeof value !== 'object') return []

  const object = value as Record<string, unknown>
  const type = object['@type']
  const types = Array.isArray(type) ? type : [type]
  const fromGraph = jsonLdBreadcrumbs(object['@graph'])

  if (!types.includes('BreadcrumbList')) return fromGraph

  const itemListElement = object.itemListElement
  if (!Array.isArray(itemListElement)) return fromGraph

  return [
    ...fromGraph,
    ...itemListElement
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        return firstString((item as Record<string, unknown>).name)
      })
      .filter((item): item is string => Boolean(item)),
  ]
}

function domBreadcrumbs($: cheerio.CheerioAPI): string[] {
  return [
    'nav[aria-label="breadcrumb"] a',
    'nav[aria-label="Breadcrumb"] a',
    '.breadcrumb a',
    '[class*="breadcrumb"] a',
    '[itemprop="itemListElement"]',
  ].flatMap((selector) =>
    $(selector)
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function cleanShopeeTitle(title: string | null): string | null {
  if (!title) return null

  const cleaned = title
    .replace(/\s*[|-]\s*Shopee.*$/i, '')
    .trim()

  return cleaned || title
}

export const shopeeAdapter: PlatformAdapter = {
  host: 'shopee.tw',
  matches: (url) => hostMatches(url, 'shopee.tw'),
  parse(html, url) {
    const $ = cheerio.load(html)
    const result = emptyResult(url)
    const rawJsonLd = extractJsonLd($)
    const structuredStore = findStructuredStore(rawJsonLd)
    const galleryImageUrls = extractGalleryImages($, url)

    const brandName = cleanShopeeTitle(
      metaContent($, 'meta[property="og:title"]') ||
        firstString(structuredStore?.name) ||
        textContent($, 'h1') ||
        textContent($, '[class*="shop-name"]') ||
        textContent($, '[data-testid*="shop"] h1')
    )

    const description =
      metaContent($, 'meta[property="og:description"]') ||
      metaContent($, 'meta[name="description"]') ||
      firstString(structuredStore?.description) ||
      textContent($, '[class*="shop-description"]') ||
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
      categoryHints: unique([
        ...extractCategoryHints($),
        ...domBreadcrumbs($),
        ...jsonLdBreadcrumbs(rawJsonLd),
      ]),
      rawJsonLd,
    }
  },
}
