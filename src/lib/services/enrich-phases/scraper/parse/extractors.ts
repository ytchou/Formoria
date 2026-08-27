import * as cheerio from 'cheerio'
import { auditedCall } from '@/lib/audit'
import {
  ONLINE_STORES,
  type OnlineStoreCamelField,
} from '@/lib/brands/online-stores'
import type { ScrapedBrandData, ScrapedImageSource } from '@/lib/types/scraper'
import { resolveUrl } from '../fetch-guards'

// Default cap for the generic web path. Callers that pull from a source with
// no per-image cost (platform adapters) pass a larger explicit limit instead.
const MAX_GALLERY_IMAGES = 5

/**
 * cheerio does not re-export domhandler's node types, so derive the node type
 * from the querying function rather than depending on domhandler directly
 * (it is not a hoisted dependency under pnpm).
 */
type CheerioNode =
  ReturnType<cheerio.CheerioAPI> extends cheerio.Cheerio<infer N> ? N : never

export type GalleryImageOptions = {
  limit?: number
  rootSelector?: string
  /**
   * Optional per-element veto, used by the Instagram adapter to drop video
   * poster frames. Returning `false` (or omitting the predicate entirely) keeps
   * the image, so a caller whose selectors stop matching degrades to today's
   * behaviour instead of dropping the gallery.
   */
  skip?: (el: CheerioNode, $: cheerio.CheerioAPI) => boolean
}
// Shares the 480px short-edge floor used by the download stage so both feeds
// into the candidate pool agree. This only fires when BOTH the width and
// height HTML attributes are present, which is often not the case, so the
// download-stage gate in image-download.ts remains the real guarantee.
const MIN_IMAGE_DIMENSION = 480

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

/**
 * Builds a "this is a PROFILE" matcher for a social host: the host, exactly one
 * path segment, an optional trailing slash, and nothing else.
 *
 * Matching any URL on the platform is not the same thing: a live run captured
 * `instagram.com/p/DQeL94sEv9G/` — a single post permalink — as a brand's
 * Instagram, so every visitor would have been sent to one photo instead of the
 * account. `reservedPaths` drops the platform's own non-profile sections whose
 * first segment is otherwise shaped exactly like a handle.
 *
 * Deliberately the same shape as `URL_TO_LINK_COLUMN` in
 * `lib/services/link-enrichment.ts`, which classifies URLs arriving from search
 * rather than from a scraped page. The two modules stay separate, but they must
 * not disagree about what counts as a profile.
 */
function socialProfilePattern(
  hostPattern: string,
  { handlePrefix = '', reservedPaths = [] }: { handlePrefix?: string; reservedPaths?: string[] } = {}
): RegExp {
  const reserved = reservedPaths.length > 0 ? `(?!(?:${reservedPaths.join('|')})(?:[/?#]|$))` : ''
  return new RegExp(`${hostPattern}\\/${handlePrefix}${reserved}[^/?#]+\\/?$`, 'i')
}

const INSTAGRAM_PROFILE_RE = socialProfilePattern('instagram\\.com', {
  reservedPaths: ['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'share'],
})

// Meta migrated Threads to threads.com while threads.net links stay in the wild,
// so both hosts must match — the old `threads.net`-only test silently dropped
// every threads.com profile. A Threads handle always carries the `@` prefix, and
// a post URL (`/@handle/post/…`) has more than one segment, so it cannot match.
const THREADS_PROFILE_RE = socialProfilePattern('threads\\.(?:net|com)', { handlePrefix: '@' })

const FACEBOOK_PROFILE_RE = socialProfilePattern('facebook\\.com', {
  reservedPaths: ['docs', 'share', 'sharer', 'help', 'policies', 'terms', 'privacy', 'login'],
})

export function extractSocialLinks($: cheerio.CheerioAPI) {
  let instagram: string | null = null
  let threads: string | null = null
  let facebook: string | null = null

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    if (!instagram && INSTAGRAM_PROFILE_RE.test(href)) {
      instagram = href
    }
    if (!threads && THREADS_PROFILE_RE.test(href)) {
      threads = href
    }
    if (!facebook && FACEBOOK_PROFILE_RE.test(href) && !/developers\.facebook\.com/i.test(href)) {
      facebook = href
    }
  })

  return { socialInstagram: instagram, socialThreads: threads, socialFacebook: facebook }
}

export function extractPurchaseLinks(
  $: cheerio.CheerioAPI,
): Pick<ScrapedBrandData, OnlineStoreCamelField> {
  const links = Object.fromEntries(
    ONLINE_STORES.map((channel) => [channel.camel, null]),
  ) as Pick<ScrapedBrandData, OnlineStoreCamelField>

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    for (const channel of ONLINE_STORES) {
      if (links[channel.camel]) continue
      // Harvesting is deliberately host-level, NOT `channel.urlPattern`. The
      // registry's `urlPattern` is the STRICT classification matcher used by
      // `URL_TO_LINK_COLUMN` to decide which column a *submitted* URL belongs
      // to; reusing it here would silently narrow the harvest and drop
      // `pinkoi.com/product/…`, `shopee.tw/shop/…` and query-string variants
      // that this extractor has always kept. `hosts` covers `shopee.com.tw`
      // too, so no per-store exception is needed.
      if (!channel.hosts.some((host) => hostMatches(href, host))) continue
      links[channel.camel] = href
    }
  })

  return links
}

/**
 * Pick the highest-resolution entry from a `srcset`. srcset is authored
 * smallest-first, so reading entry zero — which this used to do — handed the
 * downloader the lowest-resolution variant of every image and then failed it on
 * the short-edge floor.
 *
 * Entries without a `w` descriptor (a bare URL, or an `x` density descriptor
 * whose pixel size we cannot compare) rank below every sized entry and settle
 * ties by document order, so a single undescribed URL is still returned.
 */
export function largestSrcsetUrl(srcset: string): string {
  let bestUrl = ''
  let bestWidth = -1

  for (const entry of srcset.split(',')) {
    const parts = entry.trim().split(/\s+/).filter(Boolean)
    const url = parts.at(0)
    if (!url) continue

    const width = Number(parts.at(1)?.match(/^(\d+)w$/)?.at(1) ?? 0)
    if (width > bestWidth) {
      bestWidth = width
      bestUrl = url
    }
  }

  return bestUrl
}

export function extractGalleryImages(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  { limit = MAX_GALLERY_IMAGES, skip, rootSelector = 'img' }: GalleryImageOptions = {}
): string[] {
  const urls: string[] = []

  $(rootSelector).each((_, el) => {
    if (urls.length >= limit) return

    if (skip?.(el, $)) return

    // Resolve candidate URL: prefer data-src / data-original (lazy-load), then src
    const rawSrc =
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('src') ||
      ''

    // Fall back to the widest srcset variant when no direct src is present
    const srcsetLargest = largestSrcsetUrl($(el).attr('srcset') ?? '')

    const raw = rawSrc || srcsetLargest
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

export function extractScopedProductImages(
  $: cheerio.CheerioAPI,
  selectors: readonly string[],
  pageUrl: string,
  limit: number = MAX_GALLERY_IMAGES,
): string[] {
  const urls: string[] = []
  $(selectors.join(', ')).each((_, element) => {
    if (urls.length >= limit) return
    const raw = $(element).attr('data-src') ?? $(element).attr('data-original') ?? $(element).attr('src') ?? ''
    const srcsetFallback = raw ? '' : largestSrcsetUrl($(element).attr('srcset') ?? '')
    const candidate = raw || srcsetFallback
    if (!candidate || candidate.startsWith('data:')) return
    try {
      const parsed = new URL(candidate, pageUrl)
      if (NON_PRODUCT_IMAGE_PATH_RE.test(parsed.pathname)) return
      if (!urls.includes(parsed.href)) urls.push(parsed.href)
    } catch {}
  })
  return urls
}

export function extractPinkoiProductImages(
  $: cheerio.CheerioAPI,
  limit: number = MAX_GALLERY_IMAGES
): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= limit) return

    const candidates = [$(el).attr('data-src'), $(el).attr('src')]

    for (const raw of candidates) {
      if (!raw) continue

      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        continue
      }

      if (!/^cdn\d+\.pinkoi\.com$/i.test(parsed.hostname)) continue
      if (!parsed.pathname.toLowerCase().startsWith('/product/')) continue
      if (/(\/store\/|\/avatar\/|\/banner\/)/i.test(parsed.pathname)) continue

      parsed.pathname = parsed.pathname.replace(
        /\/\d+x\d+\.(jpe?g|png|webp)$/i,
        '/800x0.$1',
      )
      urls.push(parsed.href)
      break
    }
  })

  return urls
}

export function extractShopeeProductImages(
  $: cheerio.CheerioAPI,
  limit: number = MAX_GALLERY_IMAGES
): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= limit) return

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

export function extractMyshipProductImages(
  $: cheerio.CheerioAPI,
  limit: number = MAX_GALLERY_IMAGES,
  pageUrl?: string,
): string[] {
  const urls: string[] = []

  $('img').each((_, el) => {
    if (urls.length >= limit) return

    const candidates = [$(el).attr('data-src'), $(el).attr('src')]

    for (const raw of candidates) {
      if (!raw) continue

      let parsed: URL
      try {
        parsed = pageUrl ? new URL(raw, pageUrl) : new URL(raw)
      } catch {
        continue
      }

      // Pin the host the way both siblings do (cdn01.pinkoi.com,
      // *.susercontent.com). MyShip's image CDN hostname is not documented
      // anywhere in this repo, so this pins the conservative superset — the
      // MyShip origin itself plus any 7-11.com.tw subdomain — which still
      // closes the hole where a third-party asset whose path merely contains
      // `/i/cgdm/GM…` is ingested as brand gallery content. Narrow to the exact
      // CDN host once a real MyShip storefront scrape confirms it.
      const hostname = parsed.hostname.toLowerCase()
      if (hostname !== '7-11.com.tw' && !hostname.endsWith('.7-11.com.tw')) continue
      if (!/\/i\/cgdm\/GM\d+/i.test(parsed.pathname)) continue

      urls.push(parsed.toString())
      break
    }
  })

  return urls
}

/**
 * Tag an already-ordered gallery with the method that produced it, so the
 * download stage can persist provenance instead of a bare URL.
 */
export function toImageSources(
  urls: string[],
  method: string,
  pageUrl: string
): ScrapedImageSource[] {
  return urls.map((url, position) => ({ url, method, pageUrl, position }))
}

/**
 * Parse an icon `sizes` attribute (e.g. "192x192") into a comparable number.
 * Returns 0 when the format is unrecognised.
 */
function parseIconSize(sizes: string | undefined): number {
  if (!sizes) return 0
  const match = sizes.match(/^(\d+)x(\d+)$/i)
  if (!match) return 0
  return Math.max(Number(match[1]), Number(match[2]))
}

const MANIFEST_FETCH_TIMEOUT_MS = 5_000

/**
 * Extract favicon / app-icon URLs from a page, ordered by quality:
 * 1. apple-touch-icon (usually 180x180 PNG)
 * 2. generic <link rel="icon"> (excluding .ico), sorted by `sizes` descending
 * 3. Web manifest fallback — fetch manifest.json, pick the largest icon
 */
export async function extractFavicons(
  $: cheerio.CheerioAPI,
  baseUrl: string
): Promise<string[]> {
  const urls: string[] = []

  // 1. apple-touch-icon
  $('link[rel="apple-touch-icon"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    const resolved = resolveUrl(href, baseUrl)
    if (resolved) urls.push(resolved)
  })

  // 2. generic <link rel="icon">, filter .ico, sort by sizes descending
  const iconEntries: Array<{ url: string; size: number }> = []
  $('link[rel="icon"]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    const resolved = resolveUrl(href, baseUrl)
    if (!resolved) return
    try {
      const pathname = new URL(resolved).pathname
      if (pathname.toLowerCase().endsWith('.ico')) return
    } catch {
      return
    }
    iconEntries.push({
      url: resolved,
      size: parseIconSize($(el).attr('sizes') ?? undefined),
    })
  })
  iconEntries.sort((a, b) => b.size - a.size)
  for (const entry of iconEntries) {
    urls.push(entry.url)
  }

  if (urls.length > 0) return urls

  // 3. Web manifest fallback — only when no link icons were found
  const manifestHref = $('link[rel="manifest"]').attr('href')
  if (!manifestHref) return []

  const manifestUrl = resolveUrl(manifestHref, baseUrl)
  if (!manifestUrl) return []

  try {
    const manifestIcons = await auditedCall(
      { provider: 'http', operation: 'fetch_manifest', kind: 'external' },
      async (): Promise<string[]> => {
        const response = await fetch(manifestUrl, {
          signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) return []

        const manifest = (await response.json()) as {
          icons?: Array<{ src?: string; sizes?: string }>
        }
        if (!Array.isArray(manifest.icons) || manifest.icons.length === 0)
          return []

        // Pick the largest icon
        const sorted = [...manifest.icons]
          .filter((icon) => icon.src)
          .sort((a, b) => parseIconSize(b.sizes) - parseIconSize(a.sizes))

        const best = sorted[0]
        if (!best?.src) return []

        const resolved = resolveUrl(best.src, baseUrl)
        return resolved ? [resolved] : []
      },
    )
    return manifestIcons
  } catch {
    // Manifest fetch failed — skip silently
    return []
  }
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
  return [...urls].map(upgradeEcommerceImageUrl).slice(0, MAX_JSON_LD_IMAGES)
}

export function upgradeEcommerceImageUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname

    // Shopify: strip _NxN or _Nx dimension suffix before extension
    if (host.includes('cdn.shopify.com') || host.includes('myshopify.com')) {
      u.pathname = u.pathname.replace(/_\d+x\d*(?=\.\w+$)/, '')
      return u.href
    }

    // Cyberbiz: strip -NxN dimension segment before extension
    if (host.includes('cyberbiz.co')) {
      u.pathname = u.pathname.replace(/-\d+x\d+(?=\.\w+$)/, '')
      return u.href
    }

    // Shopline: strip w/width query params
    if (host.includes('shoplineapp.com') || host.includes('shoplineimg.com')) {
      u.searchParams.delete('w')
      u.searchParams.delete('width')
      return u.href
    }

    // Pinkoi: rewrite NxN dimension segment to 1080x0
    if (/^cdn\d+\.pinkoi\.com$/i.test(host)) {
      u.pathname = u.pathname.replace(
        /\/\d+x\d+\.(jpe?g|png|webp)$/i,
        '/1080x0.$1',
      )
      return u.href
    }

    return url
  } catch {
    return url
  }
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
    purchaseMyship: null,
    categoryHints: [],
    websiteUrl,
    rawJsonLd: null,
    stockistPageText: null,
    jsonLdImageUrls: [],
    faviconUrls: [],
  }
}
