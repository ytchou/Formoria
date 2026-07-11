import * as cheerio from 'cheerio'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { resolveUrl } from '../fetch-guards'

export const MAX_GALLERY_IMAGES = 5
const MIN_IMAGE_DIMENSION = 200

const NON_PRODUCT_IMAGE_PATH_RE =
  /\/(logo|avatar|profile|banner|icon|favicon|placeholder|default|sprite|pixel|shopfront_promotion)/i

export function hostMatches(url: string, host: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === host || hostname.endsWith(`.${host}`)
  } catch {
    return false
  }
}

export function metaContent($: cheerio.CheerioAPI, selector: string): string | null {
  return $(selector).attr('content')?.trim() || null
}

export function textContent($: cheerio.CheerioAPI, selector: string): string | null {
  const text = $(selector).first().text().replace(/\s+/g, ' ').trim()
  return text || null
}

export function firstString(value: unknown): string | null {
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

export function findStructuredStore(value: unknown): Record<string, unknown> | null {
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

export function jsonLdBreadcrumbs(value: unknown): string[] {
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

export function domBreadcrumbs($: cheerio.CheerioAPI): string[] {
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

export function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function extractSocialLinks($: cheerio.CheerioAPI) {
  let instagram: string | null = null
  let threads: string | null = null
  let facebook: string | null = null

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!instagram && /instagram\.com\//i.test(href)) {
      instagram = href
    }
    if (!threads && /threads\.net\//i.test(href)) {
      threads = href
    }
    if (!facebook && /facebook\.com\/[^/?#]+\/?$/i.test(href) && !/developers\.facebook\.com/i.test(href) && !/facebook\.com\/(?:docs|share|sharer|help|policies|terms|privacy|login)\b/i.test(href)) {
      facebook = href
    }
  })

  return { socialInstagram: instagram, socialThreads: threads, socialFacebook: facebook }
}

export function extractPurchaseLinks($: cheerio.CheerioAPI): {
  purchaseWebsite: string | null
  purchasePinkoi: string | null
  purchaseShopee: string | null
} {
  let pinkoi: string | null = null
  let shopee: string | null = null

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!pinkoi && /pinkoi\.com\//i.test(href)) {
      pinkoi = href
    }
    if (!shopee && /shopee\.(com\.)?tw\//i.test(href)) {
      shopee = href
    }
  })

  return { purchaseWebsite: null, purchasePinkoi: pinkoi, purchaseShopee: shopee }
}

export function extractGalleryImages(
  $: cheerio.CheerioAPI,
  pageUrl: string
): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= MAX_GALLERY_IMAGES) return

    // Resolve candidate URL: prefer data-src / data-original (lazy-load), then src
    const rawSrc =
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('src') ||
      ''

    // Also check srcset — take the first URL from the list
    const srcset = $(el).attr('srcset') ?? ''
    const srcsetFirst = srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? ''

    const raw = rawSrc || srcsetFirst
    if (!raw || raw.startsWith('data:')) return

    const resolved = resolveUrl(raw, pageUrl)
    if (!resolved) return

    // Block non-product images: logos, icons, banners, etc.
    try {
      const pathname = new URL(resolved).pathname
      if (NON_PRODUCT_IMAGE_PATH_RE.test(pathname)) return
    } catch {
      return
    }

    // Skip small images when dimensions are available
    const width = parseInt($(el).attr('width') ?? '0', 10)
    const height = parseInt($(el).attr('height') ?? '0', 10)
    if (width > 0 && height > 0 && width < MIN_IMAGE_DIMENSION && height < MIN_IMAGE_DIMENSION) {
      return
    }

    urls.push(resolved)
  })

  return urls
}

export function extractPinkoiProductImages($: cheerio.CheerioAPI): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= MAX_GALLERY_IMAGES) return

    const candidates = [$(el).attr('data-src'), $(el).attr('src')]

    for (const raw of candidates) {
      if (!raw) continue

      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        continue
      }

      if (parsed.hostname.toLowerCase() !== 'cdn01.pinkoi.com') continue
      if (!parsed.pathname.toLowerCase().startsWith('/product/')) continue
      if (/(\/store\/|\/avatar\/|\/banner\/)/i.test(parsed.pathname)) continue

      urls.push(raw)
      break
    }
  })

  return urls
}

export function extractShopeeProductImages($: cheerio.CheerioAPI): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= MAX_GALLERY_IMAGES) return

    const candidates = [$(el).attr('data-src'), $(el).attr('src')]

    for (const raw of candidates) {
      if (!raw) continue

      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        continue
      }

      const hostname = parsed.hostname.toLowerCase()
      if (hostname !== 'susercontent.com' && !hostname.endsWith('.susercontent.com')) continue
      if (!parsed.pathname.toLowerCase().startsWith('/file/')) continue
      if (/(avatar|icon|logo|banner)/i.test(raw)) continue

      urls.push(raw)
      break
    }
  })

  return urls
}

export function extractJsonLd($: cheerio.CheerioAPI): Record<string, unknown> | null {
  const scriptTag = $('script[type="application/ld+json"]').first().html()
  if (!scriptTag) return null

  try {
    return JSON.parse(scriptTag) as Record<string, unknown>
  } catch {
    return null
  }
}

export function extractCategoryHints($: cheerio.CheerioAPI): string[] {
  const keywords = $('meta[name="keywords"]').attr('content')
  if (!keywords) return []

  return keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}

export function filterHeroImage(rawUrl: string, pageUrl: string): string | null {
  const resolved = resolveUrl(rawUrl, pageUrl)
  if (!resolved) return null

  try {
    const pathname = new URL(resolved).pathname
    if (NON_PRODUCT_IMAGE_PATH_RE.test(pathname)) return null
  } catch {
    return null
  }

  return resolved
}

export const MAX_JSON_LD_IMAGES = 10

export function extractAllJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      results.push(parsed)
    } catch {
      // skip malformed JSON-LD
    }
  })
  return results
}

function extractImageUrls(
  image: unknown,
  pageUrl: string,
  urls: Set<string>
): void {
  if (typeof image === 'string') {
    const resolved = resolveUrl(image, pageUrl)
    if (!resolved) return
    try {
      const pathname = new URL(resolved).pathname
      if (NON_PRODUCT_IMAGE_PATH_RE.test(pathname)) return
    } catch {
      return
    }
    urls.add(resolved)
    return
  }

  if (Array.isArray(image)) {
    for (const item of image) {
      extractImageUrls(item, pageUrl, urls)
    }
    return
  }

  if (image && typeof image === 'object') {
    const obj = image as Record<string, unknown>
    if (obj.url && typeof obj.url === 'string') {
      extractImageUrls(obj.url, pageUrl, urls)
    }
  }
}

function collectJsonLdImages(
  objects: Record<string, unknown>[],
  pageUrl: string,
  urls: Set<string>
): void {
  for (const obj of objects) {
    // Recurse into @graph
    if (Array.isArray(obj['@graph'])) {
      collectJsonLdImages(
        obj['@graph'] as Record<string, unknown>[],
        pageUrl,
        urls
      )
    }

    const type = obj['@type']
    const types = Array.isArray(type) ? type : [type]

    // Handle ItemList -> itemListElement[].item
    if (types.includes('ItemList') && Array.isArray(obj.itemListElement)) {
      for (const element of obj.itemListElement as Record<string, unknown>[]) {
        if (element.item && typeof element.item === 'object') {
          collectJsonLdImages(
            [element.item as Record<string, unknown>],
            pageUrl,
            urls
          )
        }
      }
    }

    // Extract image from any typed object that has one
    if (obj.image !== undefined) {
      extractImageUrls(obj.image, pageUrl, urls)
    }
  }
}

export function extractJsonLdImages(
  jsonLdObjects: Record<string, unknown>[],
  pageUrl: string
): string[] {
  const urls = new Set<string>()
  collectJsonLdImages(jsonLdObjects, pageUrl, urls)
  return [...urls].slice(0, MAX_JSON_LD_IMAGES)
}

export function emptyResult(websiteUrl: string): ScrapedBrandData {
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
    categoryHints: [],
    websiteUrl,
    rawJsonLd: null,
    stockistPageText: null,
    jsonLdImageUrls: [],
  }
}
