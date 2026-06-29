import * as cheerio from 'cheerio'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import { resolveUrl } from '../fetch-guards'

export const MAX_GALLERY_IMAGES = 5
const MIN_IMAGE_DIMENSION = 200

const NON_PRODUCT_IMAGE_PATH_RE =
  /\/(logo|avatar|profile|banner|icon|favicon|placeholder|default|sprite|pixel|shopfront_promotion)/i

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
  }
}
