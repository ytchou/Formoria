import * as cheerio from 'cheerio'
import { auditedCall } from '@/lib/audit'
import { normalizeProductUrl } from './product-candidates'
import { shuffle } from '@/lib/utils'
import {
  fetchHtmlWithMetadata,
  fetchTextDocument,
  fetchXml,
  resolveUrl,
} from './scraper/fetch-guards'
import {
  identifyPlatform,
  isOwnedProductRoute,
  type PlatformId,
} from './scraper/platforms'
import { upgradeEcommerceImageUrl } from './scraper/parse/extractors'
import type { RenderProvider } from './scraper/render/types'
import { extractRenderedMainText } from './scraper/product-origin-text'

type CatalogZeroReason = 'no_catalog' | 'render_blocked' | 'route_broken'

type CatalogProductTriple = {
  url: string
  title: string
  imageUrl: string
  platform: PlatformId | 'generic'
  supplier: string
  sourceUrl: string
  sourcePosition: number
  featured?: boolean
  group?: string
}

type CatalogEvidence = {
  title: string | null
  text: string
  imageUrls: string[]
}

type CatalogAttemptSummary = {
  sourceUrl: string
  platform: PlatformId | 'generic'
  extractor: string
  staticOutcome: 'usable' | 'empty' | 'failed'
  renderOutcome: 'not_requested' | 'usable' | 'empty' | 'failed' | 'unavailable'
  sitemapLocations: number
  rawUrls: number
  ownedDetailUrls: number
  completeTriples: number
  selected: number
  hydrated: number
  usable: number
  drops: Record<string, number>
  contentSamplingOutcome?: 'not_triggered' | 'usable' | 'empty'
}

export type CatalogDiscoveryResult = {
  triples: CatalogProductTriple[]
  attempts: CatalogAttemptSummary[]
  evidence: Map<string, CatalogEvidence>
  zeroReason?: CatalogZeroReason
}

export type CatalogSource = {
  url: string
  channel: 'official' | 'pinkoi' | 'shopee' | 'myship'
}
type CatalogFetchResult = {
  text: string | null
  status: number | null
  error: string | null
}
export type CatalogFetch = (
  url: string,
  kind: 'html' | 'xml' | 'text',
) => Promise<CatalogFetchResult>

export type DiscoverCatalogOptions = {
  sources: readonly CatalogSource[]
  renderProvider?: RenderProvider
  fetcher?: CatalogFetch
  target?: number
  hydrationLimit?: number
  entryUrls?: string[]
  priorityProductUrls?: string[]
}

type RouteCandidate = {
  url: string
  title?: string
  imageUrl?: string
  sourcePosition: number
  featured?: boolean
  group?: string
}

type CheerioNode =
  ReturnType<cheerio.CheerioAPI> extends cheerio.Cheerio<infer Node>
    ? Node
    : never

const MAX_SITEMAP_DOCUMENTS = 20
const MAX_SITEMAP_LOCATIONS = 2_000
const MAX_SITEMAP_DEPTH = 2
const HYDRATION_CONCURRENCY = 5
const SKIP_PATTERN = /\/(about|contact|privacy|terms|faq|blog|news|pages|category|tag|author|cart|checkout)(\/|$)/i

const SPECIALIZED_ROUTE_SELECTORS: Partial<Record<PlatformId, string>> = {
  shopline:
    '[data-product-id] a[href], .product-item a[href], .product-card a[href], a[href*="/products/"]',
  '91app':
    '[data-salepageid] a[href], .product-card a[href], a[href*="SalePage/Index/"]',
  shop2000:
    '.product-item a[href], .product-list a[href], a[href*="/product/"], a[href*="product_id="]',
  cyberbiz:
    '[data-product-id] a[href], .product-card a[href], .product-item a[href], a[href*="/products/"]',
  pinkoi:
    '[data-product-id] a[href], .product-item a[href], .product-card a[href], a[href*="/product/"]',
  // Shopee: permanently blocked (render_blocked, pure SPA with zero static text).
  // Classification confirmed correct — see DEV-1631. No static extraction possible.
  shopee:
    '[data-sqe="item"] a[href], .shopee-search-item-result__item a[href], a[data-sqe="link"]',
  myship:
    '[data-product-id] a[href], .product-item a[href], .product-card a[href], a[href*="/general/detail/GM"]',
}

async function defaultFetch(
  url: string,
  kind: 'html' | 'xml' | 'text',
): Promise<CatalogFetchResult> {
  if (kind === 'html') {
    const result = await fetchHtmlWithMetadata(url)
    return { text: result.text, status: result.status, error: result.error }
  }
  const text =
    kind === 'xml' ? await fetchXml(url) : await fetchTextDocument(url)
  return {
    text,
    status: text === null ? null : 200,
    error: text === null ? 'fetch failed' : null,
  }
}

function imageFromElement(
  $: cheerio.CheerioAPI,
  element: CheerioNode,
  pageUrl: string,
): string | undefined {
  const image = $(element).find('img').first()
  const raw =
    image.attr('data-src') ?? image.attr('data-original') ?? image.attr('src')
  const resolved = raw ? resolveUrl(raw, pageUrl) : undefined
  return resolved ? upgradeEcommerceImageUrl(resolved) : undefined
}

export function extractCatalogRoutes(
  html: string,
  sourceUrl: string,
  platform = identifyPlatform(sourceUrl, html),
): RouteCandidate[] {
  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const routes: RouteCandidate[] = []
  const selector = platform
    ? (SPECIALIZED_ROUTE_SELECTORS[platform] ?? 'a[href]')
    : 'a[href]'
  $(selector).each((position, element) => {
    const raw = $(element).attr('href') ?? ''
    const url = resolveUrl(raw, sourceUrl)
    const normalized = url ? normalizeProductUrl(url) : null
    if (!url || !normalized || seen.has(normalized)) return
    if (!isOwnedProductRoute(url, sourceUrl, platform)) return
    seen.add(normalized)
    const container = $(element).closest(
      '[data-category], [data-group], [data-featured], article, li',
    )
    const title = ($(element).attr('title') ?? $(element).text())
      .replace(/\s+/gu, ' ')
      .trim()
    const imageUrl = imageFromElement($, element, sourceUrl)
    routes.push({
      url,
      ...(title ? { title } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      sourcePosition: position,
      ...(container.attr('data-featured') === 'true' ? { featured: true } : {}),
      ...((container.attr('data-category') ?? container.attr('data-group'))
        ? {
            group:
              container.attr('data-category') ?? container.attr('data-group'),
          }
        : {}),
    })
  })
  return routes
}

function selectBreadthFirst(routes: RouteCandidate[]): RouteCandidate[] {
  const featured = routes.filter((route) => route.featured)
  const rest = routes.filter((route) => !route.featured)
  const grouped = new Map<string, RouteCandidate[]>()
  const ungrouped: RouteCandidate[] = []
  for (const route of rest) {
    if (!route.group) ungrouped.push(route)
    else grouped.set(route.group, [...(grouped.get(route.group) ?? []), route])
  }
  if (grouped.size === 0) return [...featured, ...ungrouped]
  const roundRobin: RouteCandidate[] = []
  for (let index = 0; ; index += 1) {
    let added = false
    for (const routesInGroup of grouped.values()) {
      const route = routesInGroup[index]
      if (route) {
        roundRobin.push(route)
        added = true
      }
    }
    if (!added) break
  }
  return [...featured, ...roundRobin, ...ungrouped]
}

function parseEvidence(html: string, pageUrl: string): CatalogEvidence {
  const $ = cheerio.load(html)
  const productJson = $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((node) => {
      try {
        const parsed = JSON.parse($(node).html() ?? 'null') as unknown
        const values = Array.isArray(parsed) ? parsed : [parsed]
        return values.flatMap((value) =>
          value &&
          typeof value === 'object' &&
          Array.isArray((value as Record<string, unknown>)['@graph'])
            ? [
                value as Record<string, unknown>,
                ...((value as Record<string, unknown>)['@graph'] as unknown[]),
              ]
            : [value],
        )
      } catch {
        return []
      }
    })
    .find(
      (value) =>
        value &&
        typeof value === 'object' &&
        [(value as Record<string, unknown>)['@type']]
          .flat()
          .includes('Product'),
    ) as Record<string, unknown> | undefined
  const rawImage = productJson?.image
  const jsonImages = (Array.isArray(rawImage) ? rawImage : [rawImage]).flatMap(
    (value) => {
      if (typeof value === 'string') return [value]
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).url === 'string'
      )
        return [(value as Record<string, unknown>).url as string]
      return []
    },
  )
  const metaImage =
    $('meta[property="og:image"]').attr('content') ??
    $('meta[name="twitter:image"]').attr('content')
  const imageUrls = [
    ...new Set(
      [...jsonImages, ...(metaImage ? [metaImage] : [])]
        .map((url) => resolveUrl(url, pageUrl))
        .filter((url): url is string => Boolean(url)),
    ),
  ]
  const title =
    [
      productJson?.name,
      $('meta[property="og:title"]').attr('content'),
      $('h1').first().text(),
      $('title').text(),
    ]
      .find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      )
      ?.replace(/\s+/gu, ' ')
      .trim() ?? null
  return {
    title,
    text: extractRenderedMainText(html).slice(0, 8_000),
    imageUrls,
  }
}

async function sitemapUrls(
  sourceUrl: string,
  fetcher: CatalogFetch,
): Promise<{ urls: string[]; locations: number }> {
  const origin = new URL(sourceUrl).origin
  const robots = await fetcher(`${origin}/robots.txt`, 'text')
  const seeds = [
    ...(robots.text?.matchAll(/^\s*Sitemap:\s*(\S+)/gim) ?? []),
  ]
    .map((match) => resolveUrl(match[1]!, `${origin}/robots.txt`))
    .filter((url): url is string => Boolean(url))
  if (seeds.length === 0) seeds.push(`${origin}/sitemap.xml`)
  const queue = seeds.map((url) => ({ url, depth: 0 }))
  const visited = new Set<string>()
  const urls: string[] = []
  let locations = 0
  while (
    queue.length > 0 &&
    visited.size < MAX_SITEMAP_DOCUMENTS &&
    locations < MAX_SITEMAP_LOCATIONS
  ) {
    const next = queue.shift()!
    if (visited.has(next.url)) continue
    visited.add(next.url)
    const result = await fetcher(next.url, 'xml')
    if (!result.text) continue
    const $ = cheerio.load(result.text, { xmlMode: true })
    const locs = $('loc')
      .toArray()
      .map((node) => resolveUrl($(node).text().trim(), next.url))
      .filter((url): url is string => Boolean(url))
      .slice(0, MAX_SITEMAP_LOCATIONS - locations)
    locations += locs.length
    const isIndex = $('sitemapindex').length > 0
    if (isIndex && next.depth < MAX_SITEMAP_DEPTH) {
      queue.push(...locs.map((url) => ({ url, depth: next.depth + 1 })))
    } else if (!isIndex) {
      urls.push(...locs.slice(0, MAX_SITEMAP_LOCATIONS - urls.length))
    }
  }
  return { urls, locations: Math.min(locations, MAX_SITEMAP_LOCATIONS) }
}

export function needsRendering(html: string): boolean {
  if (!html.trim()) return true
  const $ = cheerio.load(html)
  const visibleText = $('body').text().replace(/\s+/gu, ' ').trim()
  return visibleText.length === 0 ||
    (visibleText.length < 20 && $('script').length > 0)
}

// @visibleForTesting
export function hasProductSignals(html: string): boolean {
  const $ = cheerio.load(html)

  // JSON-LD @type: "Product"
  const jsonLdScripts = $('script[type="application/ld+json"]')
  for (const el of jsonLdScripts.toArray()) {
    const text = $(el).text()
    if (/"@type"\s*:\s*"Product"/u.test(text) || /"@type"\s*:\s*\[[^\]]*"Product"/u.test(text)) return true
  }

  // OpenGraph og:type with value "product"
  const ogType = $('meta[property="og:type"]').attr('content')
  if (ogType?.toLowerCase() === 'product') return true

  // OpenGraph product:price:amount
  if ($('meta[property="product:price:amount"]').length > 0) return true

  // Microdata schema.org/Product
  if ($('[itemtype="https://schema.org/Product"], [itemtype="http://schema.org/Product"]').length > 0) return true

  return false
}

type HydratedRoute = {
  route: RouteCandidate
  evidence: CatalogEvidence
  reachable: boolean
  renderOutcome: CatalogAttemptSummary['renderOutcome']
  renderBlocked: boolean
  hasSignals: boolean
}

export async function discoverCatalog(
  options: DiscoverCatalogOptions,
): Promise<CatalogDiscoveryResult> {
  return auditedCall(
    { provider: 'catalog', operation: 'discover_catalog', kind: 'external' },
    async (ctx) => {
      const fetcher = options.fetcher ?? defaultFetch
      const target = options.target ?? 20
      const hydrationLimit = options.hydrationLimit ?? 25

      // Prepend valid entry URLs as extra official sources before the declared ones
      const sourceHosts = new Set(
        options.sources.map((s) => {
          try {
            return new URL(s.url).hostname.replace(/^www\./i, '').toLowerCase()
          } catch {
            return ''
          }
        }),
      )
      const entrySources: CatalogSource[] = (options.entryUrls ?? [])
        .filter((u) => {
          try {
            return sourceHosts.has(
              new URL(u).hostname.replace(/^www\./i, '').toLowerCase(),
            )
          } catch {
            return false
          }
        })
        .map((url) => ({ url, channel: 'official' as const }))
      const effectiveSources = [...entrySources, ...options.sources]

      const attempts: CatalogAttemptSummary[] = []
      const evidence = new Map<string, CatalogEvidence>()
      const triples: CatalogProductTriple[] = []
      const seen = new Set<string>()
      let hydrated = 0
      let potentiallyUsefulUnrendered = false
      let reachableSurfaces = 0
      let reachableRoutes = 0
      let deadRoutes = 0

      for (const source of effectiveSources) {
        if (triples.length >= target || hydrated >= hydrationLimit) break
        const landing = await fetcher(source.url, 'html')
        const platform =
          identifyPlatform(source.url, landing.text ?? '') ?? 'generic'
        const summary: CatalogAttemptSummary = {
          sourceUrl: source.url,
          platform,
          extractor: platform === 'generic' ? 'generic' : platform,
          staticOutcome: landing.error ? 'failed' : 'empty',
          renderOutcome: 'not_requested',
          sitemapLocations: 0,
          rawUrls: 0,
          ownedDetailUrls: 0,
          completeTriples: 0,
          selected: 0,
          hydrated: 0,
          usable: 0,
          drops: {},
          contentSamplingOutcome: 'not_triggered',
        }
        attempts.push(summary)
        if (landing.text) reachableSurfaces += 1
        let listingHtml = landing.text ?? ''
        let routes = extractCatalogRoutes(
          listingHtml,
          source.url,
          platform === 'generic' ? null : platform,
        )
        const sourceIsProduct = isOwnedProductRoute(
          source.url,
          source.url,
          platform === 'generic' ? null : platform,
        )
        if (sourceIsProduct) {
          routes.unshift({ url: source.url, sourcePosition: -1 })
        }
        const sitemap =
          source.channel === 'official'
            ? await sitemapUrls(source.url, fetcher)
            : { urls: [], locations: 0 }
        summary.sitemapLocations = sitemap.locations
        const sitemapRoutes: RouteCandidate[] = sitemap.urls
          .map((url, sourcePosition) => ({ url, sourcePosition }))
          .filter((route) =>
            isOwnedProductRoute(
              route.url,
              source.url,
              platform === 'generic' ? null : platform,
            ),
          )
        routes = [...routes, ...sitemapRoutes]
        summary.staticOutcome = routes.length > 0 ? 'usable' : summary.staticOutcome
        if (routes.length === 0 && options.renderProvider) {
          try {
            const rendered = await options.renderProvider.fetchRendered(
              source.url,
            )
            listingHtml = rendered.html
            routes = extractCatalogRoutes(
              listingHtml,
              source.url,
              platform === 'generic' ? null : platform,
            )
            summary.renderOutcome = routes.length > 0 ? 'usable' : 'empty'
          } catch {
            summary.renderOutcome = 'failed'
            potentiallyUsefulUnrendered = true
          }
        } else if (routes.length === 0) {
          summary.renderOutcome = 'unavailable'
          if (needsRendering(listingHtml)) potentiallyUsefulUnrendered = true
        }
        if (platform === 'generic' && routes.length === 0 && sitemap.urls.length > 0) {
          const candidates = sitemap.urls.filter(u => {
            try { return !SKIP_PATTERN.test(new URL(u).pathname) } catch { return false }
          })
          const sample = shuffle(candidates).slice(0, 10)
          let foundProduct = false
          let hitPrefix: string | undefined
          // Only use hitPrefix filtering for common catalog path prefixes.
          // Root-level product slugs (e.g. /my-product) would incorrectly
          // collapse all candidates to a single prefix segment.
          const CATALOG_PREFIXES = new Set([
            'products', 'shop', 'collections', 'items', 'store', 'product',
          ])
          for (const sampleUrl of sample) {
            const page = await fetcher(sampleUrl, 'html')
            if (page.text && hasProductSignals(page.text)) {
              foundProduct = true
              try {
                const seg = new URL(sampleUrl).pathname.split('/')[1]
                if (seg && CATALOG_PREFIXES.has(seg)) hitPrefix = seg
              } catch { /* noop */ }
              break
            }
          }
          if (foundProduct) {
            const promoted = hitPrefix
              ? candidates.filter(u => {
                  try { return new URL(u).pathname.split('/')[1] === hitPrefix } catch { return false }
                })
              : candidates
            routes = promoted.map((url, i) => ({ url, sourcePosition: i }))
            summary.contentSamplingOutcome = 'usable'
          } else {
            summary.contentSamplingOutcome = 'empty'
          }
        }
        summary.rawUrls = routes.length
        const breadthRoutes = selectBreadthFirst(routes)
        // Prepend priority product URLs so they hydrate first
        const priorityRoutes: RouteCandidate[] = (options.priorityProductUrls ?? [])
          .filter((u) => {
            const normalized = normalizeProductUrl(u)
            return normalized && !seen.has(normalized)
          })
          .map((url, i) => ({ url, sourcePosition: -(i + 1) }))
        const mergedRoutes = [...priorityRoutes, ...breadthRoutes]
        const uniqueRoutes = mergedRoutes.filter((route) => {
          const normalized = normalizeProductUrl(route.url)
          if (!normalized || seen.has(normalized)) return false
          seen.add(normalized)
          return true
        })
        summary.ownedDetailUrls = uniqueRoutes.length
        const selected = uniqueRoutes.slice(0, hydrationLimit - hydrated)
        let offset = 0
        while (offset < selected.length && triples.length < target) {
          const remainingTarget = target - triples.length
          const batch = selected.slice(
            offset,
            offset + Math.min(HYDRATION_CONCURRENCY, remainingTarget),
          )
          offset += batch.length
          summary.selected += batch.length
          hydrated += batch.length
          summary.hydrated += batch.length
          const hydratedRoutes = await Promise.all(
            batch.map(async (route): Promise<HydratedRoute> => {
              const page = await fetcher(route.url, 'html')
              let reachable = Boolean(page.text)
              let renderOutcome: CatalogAttemptSummary['renderOutcome'] =
                'not_requested'
              let renderBlocked = false
              let finalHtml = page.text ?? ''
              let pageEvidence = page.text
                ? parseEvidence(page.text, route.url)
                : { title: null, text: '', imageUrls: [] }
              if (
                (!pageEvidence.title || pageEvidence.imageUrls.length === 0) &&
                options.renderProvider
              ) {
                try {
                  const rendered = await options.renderProvider.fetchRendered(
                    route.url,
                  )
                  reachable = true
                  finalHtml = rendered.html
                  pageEvidence = parseEvidence(rendered.html, route.url)
                  renderOutcome =
                    pageEvidence.title && pageEvidence.imageUrls.length > 0
                      ? 'usable'
                      : 'empty'
                } catch {
                  renderOutcome = 'failed'
                  renderBlocked = true
                }
              } else if (
                (!pageEvidence.title || pageEvidence.imageUrls.length === 0) &&
                !options.renderProvider &&
                needsRendering(page.text ?? '')
              ) {
                renderOutcome = 'unavailable'
                renderBlocked = true
              }
              return {
                route,
                evidence: pageEvidence,
                reachable,
                renderOutcome,
                renderBlocked,
                hasSignals: hasProductSignals(finalHtml),
              }
            }),
          )
          for (const result of hydratedRoutes) {
            const { route, evidence: pageEvidence } = result
            if (result.reachable) reachableRoutes += 1
            else deadRoutes += 1
            if (result.renderBlocked) potentiallyUsefulUnrendered = true
            if (result.renderOutcome !== 'not_requested') {
              summary.renderOutcome = result.renderOutcome
            }
            const normalized = normalizeProductUrl(route.url)!
            evidence.set(normalized, pageEvidence)
            // Per-route product signal gate: require product signals OR a known platform product route
            const platformForGate = platform !== 'generic' ? platform : null
            if (
              !result.hasSignals &&
              !isOwnedProductRoute(route.url, source.url, platformForGate)
            ) {
              summary.drops.no_product_signals =
                (summary.drops.no_product_signals ?? 0) + 1
              continue
            }
            const title = pageEvidence.title ?? route.title
            const imageUrl = pageEvidence.imageUrls[0] ?? route.imageUrl
            if (!title || !imageUrl) {
              const reason = !title ? 'no_title' : 'no_image'
              summary.drops[reason] = (summary.drops[reason] ?? 0) + 1
              continue
            }
            triples.push({
              url: route.url,
              title,
              imageUrl,
              platform,
              supplier: `catalog:${platform}`,
              sourceUrl: source.url,
              sourcePosition: route.sourcePosition,
              ...(route.featured ? { featured: true } : {}),
              ...(route.group ? { group: route.group } : {}),
            })
            summary.completeTriples += 1
            summary.usable += 1
          }
        }
      }
      const zeroReason: CatalogZeroReason | undefined =
        triples.length > 0
          ? undefined
          : reachableSurfaces === 0 ||
              (hydrated > 0 && deadRoutes === hydrated && reachableRoutes === 0)
            ? 'route_broken'
            : potentiallyUsefulUnrendered
              ? 'render_blocked'
              : 'no_catalog'
      const ownedDetailUrls = attempts.reduce(
        (sum, attempt) => sum + attempt.ownedDetailUrls,
        0,
      )
      Object.assign(ctx.summary, {
        triples: triples.length,
        hydrated,
        zeroReason,
        catalogCompleteness:
          ownedDetailUrls > 0 ? triples.length / ownedDetailUrls : 0,
        attempts,
      })
      return {
        triples,
        attempts,
        evidence,
        ...(zeroReason ? { zeroReason } : {}),
      }
    },
  )
}
