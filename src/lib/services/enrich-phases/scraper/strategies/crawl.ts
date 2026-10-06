import * as cheerio from 'cheerio'
import { fetchHtml, fetchHtmlWithMetadata, fetchXml, resolveUrl } from '../fetch-guards'
import { isOwnedSiteHost } from '../input-detector'
import { ONLINE_STORES, type OnlineStoreCamelField } from '@/lib/brands/online-stores'
import {
  emptyResult,
  extractCategoryHints,
  extractPurchaseLinks,
  extractSocialLinks,
  toImageSources,
  MAX_JSON_LD_IMAGES,
} from '../parse/extractors'
import { mergePurchaseLinks } from '../merge'
import { classifyCandidate, getPageText, type CandidateKind } from '../parse/page-kind'
import { SinglePageStrategy } from './single-page'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { ScrapeContext, ScrapeStrategy } from './types'

type SocialLinkFields = Pick<ScrapedBrandData, 'socialInstagram' | 'socialThreads' | 'socialFacebook'>
type PurchaseLinkFields = Pick<
  ScrapedBrandData,
  OnlineStoreCamelField
>

interface CrawlCandidate {
  url: string
  text: string
  kind: CandidateKind
}

const MAX_CRAWL_PAGES = 5
const MAX_CATEGORY_HINTS = 5
const CRAWL_CONCURRENCY = 3
const ASSET_PATH_RE =
  /\.(?:avif|bmp|css|gif|ico|jpe?g|js|json|map|pdf|png|svg|webp|woff2?)$/i

function getRegistrableDomain(urlString: string): string | null {
  try {
    const labels = new URL(urlString).hostname.toLowerCase().split('.')
    if (labels.length < 2) return labels[0] ?? null

    const suffixLabelCount =
      labels.length >= 3 &&
      labels[labels.length - 1].length === 2 &&
      labels[labels.length - 2].length <= 3
        ? 3
        : 2

    return labels.slice(-suffixLabelCount).join('.')
  } catch {
    return null
  }
}

/**
 * True when `pageUrl` is on the landing page's own host or a subdomain of it.
 * `getRegistrableDomain` is a heuristic: it lets brand.myshopify.com vouch for
 * other.myshopify.com, so stockist text checks the host instead (DEV-1943).
 */
function isOnLandingHost(pageUrl: string, landingUrl: string): boolean {
  try {
    return isOwnedSiteHost(pageUrl, new Set([new URL(landingUrl).hostname]))
  } catch {
    return false
  }
}

function normalizeUrl(urlString: string): string | null {
  try {
    const parsed = new URL(urlString)
    parsed.hash = ''
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/$/, '')
    }
    return parsed.href
  } catch {
    return null
  }
}

function isAssetUrl(urlString: string): boolean {
  try {
    return ASSET_PATH_RE.test(new URL(urlString).pathname)
  } catch {
    return true
  }
}

function priorityFor(kind: CandidateKind): number {
  if (kind === 'about') return 0
  if (kind === 'stockist') return 0
  if (kind === 'products') return 1
  if (kind === 'contact') return 2
  return 3
}

function addCandidate(
  candidates: Map<string, CrawlCandidate>,
  rawUrl: string,
  pageUrl: string,
  landingUrl: string,
  landingDomain: string,
  text = ''
) {
  const resolved = resolveUrl(rawUrl, pageUrl)
  const normalized = resolved ? normalizeUrl(resolved) : null
  const normalizedLanding = normalizeUrl(landingUrl)
  if (!normalized || normalized === normalizedLanding) return
  if (isAssetUrl(normalized)) return
  if (getRegistrableDomain(normalized) !== landingDomain) return
  if (candidates.has(normalized)) return

  candidates.set(normalized, {
    url: normalized,
    text,
    kind: classifyCandidate(normalized, text),
  })
}

async function discoverSitemapCandidates(
  candidates: Map<string, CrawlCandidate>,
  pageUrl: string,
  landingDomain: string
) {
  const sitemapUrl = resolveUrl('/sitemap.xml', pageUrl)
  if (!sitemapUrl) return

  const xml = await fetchXml(sitemapUrl)
  if (!xml) return

  const $ = cheerio.load(xml, { xmlMode: true })
  $('loc').each((_, loc) => {
    addCandidate(
      candidates,
      $(loc).text().trim(),
      pageUrl,
      pageUrl,
      landingDomain
    )
  })
}

function discoverShellCandidates(
  candidates: Map<string, CrawlCandidate>,
  $: cheerio.CheerioAPI,
  pageUrl: string,
  landingDomain: string
) {
  $('nav a[href], header a[href], footer a[href]').each((_, el) => {
    addCandidate(
      candidates,
      $(el).attr('href') ?? '',
      pageUrl,
      pageUrl,
      landingDomain,
      $(el).text().trim()
    )
  })
}

async function discoverCandidates(
  html: string,
  pageUrl: string,
  skipStockist: boolean
): Promise<CrawlCandidate[]> {
  const landingDomain = getRegistrableDomain(pageUrl)
  if (!landingDomain) return []

  const candidates = new Map<string, CrawlCandidate>()
  const $ = cheerio.load(html)

  await discoverSitemapCandidates(candidates, pageUrl, landingDomain)
  discoverShellCandidates(candidates, $, pageUrl, landingDomain)

  return [...candidates.values()]
    .filter((candidate) => !(skipStockist && candidate.kind === 'stockist'))
    .sort((a, b) => priorityFor(a.kind) - priorityFor(b.kind))
    .slice(0, MAX_CRAWL_PAGES)
}

async function fetchCandidatePages(candidates: CrawlCandidate[]) {
  const pages: Array<CrawlCandidate & { html: string; finalUrl: string | null }> = []

  for (let i = 0; i < candidates.length; i += CRAWL_CONCURRENCY) {
    const chunk = candidates.slice(i, i + CRAWL_CONCURRENCY)
    const fetched = await Promise.all(
      chunk.map(async (candidate) => {
        const { text: html, finalUrl } = await fetchHtmlWithMetadata(candidate.url, {
          includeFinalUrl: true,
        })
        return html ? { ...candidate, html, finalUrl: finalUrl ?? null } : null
      })
    )

    pages.push(...fetched.filter((page) => page !== null))
  }

  return pages
}

function mergeSocialLinks(
  base: SocialLinkFields,
  next: SocialLinkFields
): SocialLinkFields {
  return {
    socialInstagram: base.socialInstagram ?? next.socialInstagram,
    socialThreads: base.socialThreads ?? next.socialThreads,
    socialFacebook: base.socialFacebook ?? next.socialFacebook,
  }
}

function mergeCategoryHints(base: string[], next: string[]): string[] {
  const seen = new Set(base)
  for (const hint of next) {
    if (seen.size >= MAX_CATEGORY_HINTS) break
    seen.add(hint)
  }
  return [...seen].slice(0, MAX_CATEGORY_HINTS)
}

export class CrawlStrategy implements ScrapeStrategy {
  readonly type = 'deep-multi-page'

  async scrape(url: string, ctx: ScrapeContext) {
    try {
      const landingHtml = ctx.prefetchedHtml ?? await fetchHtml(url)
      if (landingHtml == null) return emptyResult(url)

      const singlePage = new SinglePageStrategy()
      const result = await singlePage.scrape(url, {
        ...ctx,
        prefetchedHtml: landingHtml,
      })
      // A landing page that is itself a store locator already supplied the
      // venue list, so no crawl slot goes to a stockist sub-page.
      const candidates = await discoverCandidates(
        landingHtml,
        url,
        Boolean(result.stockistPageText)
      )
      const pages = await fetchCandidatePages(
        candidates.slice(0, ctx.maxCrawlPages ?? MAX_CRAWL_PAGES)
      )

      let socialLinks: SocialLinkFields = {
        socialInstagram: result.socialInstagram,
        socialThreads: result.socialThreads,
        socialFacebook: result.socialFacebook,
      }
      let purchaseLinks: PurchaseLinkFields = {
        ...Object.fromEntries(
          ONLINE_STORES.map((channel) => [channel.camel, null]),
        ),
      } as PurchaseLinkFields
      purchaseLinks = mergePurchaseLinks(purchaseLinks, result)
      let categoryHints = result.categoryHints
      let description = result.description
      let story = result.story
      // A landing URL that is itself a store-locator page keeps its own text;
      // a stockist sub-page only fills the gap (DEV-1943).
      let stockistPageText: string | null = result.stockistPageText

      const jsonLdImageSet = new Set(result.jsonLdImageUrls)

      for (const page of pages) {
        const $ = cheerio.load(page.html)
        const pageResult = await singlePage.scrape(page.url, {
          ...ctx,
          prefetchedHtml: page.html,
        })

        socialLinks = mergeSocialLinks(socialLinks, extractSocialLinks($))
        purchaseLinks = mergePurchaseLinks(purchaseLinks, extractPurchaseLinks($))
        categoryHints = mergeCategoryHints(
          categoryHints,
          extractCategoryHints($)
        )

        if (page.kind === 'about') {
          const pageText = pageResult.description ?? getPageText($)
          if (pageText && !description) {
            description = pageText
          } else if (pageText && !story && description !== pageText) {
            story = pageText
          }
        }

        // Both the linked URL and where its redirects landed must stay on the
        // landing host: a sibling tenant or a retailer lists its own venues.
        if (
          page.kind === 'stockist' &&
          !stockistPageText &&
          isOnLandingHost(page.url, url) &&
          (page.finalUrl === null || isOnLandingHost(page.finalUrl, url))
        ) {
          const pageText = pageResult.stockistPageText ?? getPageText($)
          if (pageText) stockistPageText = pageText
        }

        for (const imgUrl of pageResult.jsonLdImageUrls) {
          jsonLdImageSet.add(imgUrl)
        }
      }

      return {
        ...result,
        description,
        story,
        ...socialLinks,
        ...purchaseLinks,
        categoryHints,
        stockistPageText,
        // The gallery is the landing page's, but this strategy is what produced
        // it — relabel so provenance names the strategy, not the sub-scrape.
        imageSources: toImageSources(result.galleryImageUrls, 'crawl', url),
        jsonLdImageUrls: [...jsonLdImageSet].slice(0, MAX_JSON_LD_IMAGES),
      }
    } catch {
      return emptyResult(url)
    }
  }
}
