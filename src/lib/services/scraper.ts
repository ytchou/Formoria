import * as cheerio from 'cheerio'
import type { ScrapedBrandData } from '@/lib/types/scraper'

const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_GALLERY_IMAGES = 10
const MIN_IMAGE_DIMENSION = 200

function emptyResult(websiteUrl: string): ScrapedBrandData {
  return {
    brandName: null,
    description: null,
    heroImageUrl: null,
    galleryImageUrls: [],
    socialLinks: { instagram: null, threads: null, facebook: null },
    categoryHints: [],
    websiteUrl,
    rawJsonLd: null,
  }
}

function extractSocialLinks($: cheerio.CheerioAPI) {
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
    if (!facebook && /facebook\.com\//i.test(href)) {
      facebook = href
    }
  })

  return { instagram, threads, facebook }
}

function extractGalleryImages(
  $: cheerio.CheerioAPI
): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? ''

    // Skip data URIs
    if (src.startsWith('data:')) return

    // Skip favicon/icon paths
    if (/\/(favicon|icon)/i.test(src)) return

    // Skip small images when dimensions are available
    const width = parseInt($(el).attr('width') ?? '0', 10)
    const height = parseInt($(el).attr('height') ?? '0', 10)
    if (width > 0 && height > 0 && width < MIN_IMAGE_DIMENSION && height < MIN_IMAGE_DIMENSION) {
      return
    }

    if (src && urls.length < MAX_GALLERY_IMAGES) {
      urls.push(src)
    }
  })

  return urls
}

function extractJsonLd($: cheerio.CheerioAPI): Record<string, unknown> | null {
  const scriptTag = $('script[type="application/ld+json"]').first().html()
  if (!scriptTag) return null

  try {
    return JSON.parse(scriptTag) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractCategoryHints($: cheerio.CheerioAPI): string[] {
  const keywords = $('meta[name="keywords"]').attr('content')
  if (!keywords) return []

  return keywords
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
])

function isPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    const hostname = parsed.hostname

    if (BLOCKED_HOSTNAMES.has(hostname)) return true

    // Block private IP ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x
    const parts = hostname.split('.')
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const [a, b] = parts.map(Number)
      if (a === 10) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
      if (a === 0) return true
    }

    // Block non-http(s) schemes
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true

    return false
  } catch {
    return true
  }
}

export async function scrapeBrandUrl(url: string): Promise<ScrapedBrandData> {
  try {
    if (isPrivateUrl(url)) {
      return emptyResult(url)
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MITMap-Bot/1.0 (+https://mitmap.tw)',
        Accept: 'text/html',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return emptyResult(url)
    }

    // Verify content-type is HTML before reading body
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return emptyResult(url)
    }

    // Check content-length before reading body
    const contentLength = parseInt(
      response.headers.get('content-length') ?? '0',
      10
    )
    if (contentLength > MAX_RESPONSE_BYTES) {
      return emptyResult(url)
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    const brandName =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().trim() ||
      null

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      null

    const heroImageUrl =
      $('meta[property="og:image"]').attr('content') || null

    const galleryImageUrls = extractGalleryImages($)
    const socialLinks = extractSocialLinks($)
    const categoryHints = extractCategoryHints($)
    const rawJsonLd = extractJsonLd($)

    return {
      brandName,
      description,
      heroImageUrl,
      galleryImageUrls,
      socialLinks,
      categoryHints,
      websiteUrl: url,
      rawJsonLd,
    }
  } catch {
    return emptyResult(url)
  }
}
