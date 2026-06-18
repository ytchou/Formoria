import * as cheerio from 'cheerio'
import { fetchHtml, fetchXml, resolveUrl } from '../fetch-guards'
import {
  emptyResult,
  extractCategoryHints,
  extractSocialLinks,
} from '../parse/extractors'
import { SinglePageStrategy } from './single-page'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { ScrapeContext, ScrapeStrategy } from './types'

type CandidateKind = 'about' | 'products' | 'contact' | 'other'
type SocialLinkFields = Pick<ScrapedBrandData, 'socialInstagram' | 'socialThreads' | 'socialFacebook'>

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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function classifyCandidate(urlString: string, text: string): CandidateKind {
  let path = ''
  try {
    path = new URL(urlString).pathname
  } catch {
    return 'other'
  }

  const haystack = safeDecode(`${path} ${text}`).toLowerCase()
  if (/(about|story|關於|品牌)/i.test(haystack)) return 'about'
  if (/(product|shop|商品)/i.test(haystack)) return 'products'
  if (/(contact|聯絡)/i.test(haystack)) return 'contact'
  return 'other'
}

function priorityFor(kind: CandidateKind): number {
  if (kind === 'about') return 0
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
  pageUrl: string
): Promise<CrawlCandidate[]> {
  const landingDomain = getRegistrableDomain(pageUrl)
  if (!landingDomain) return []

  const candidates = new Map<string, CrawlCandidate>()
  const $ = cheerio.load(html)

  await discoverSitemapCandidates(candidates, pageUrl, landingDomain)
  discoverShellCandidates(candidates, $, pageUrl, landingDomain)

  return [...candidates.values()]
    .sort((a, b) => priorityFor(a.kind) - priorityFor(b.kind))
    .slice(0, MAX_CRAWL_PAGES)
}

async function fetchCandidatePages(candidates: CrawlCandidate[]) {
  const pages: Array<CrawlCandidate & { html: string }> = []

  for (let i = 0; i < candidates.length; i += CRAWL_CONCURRENCY) {
    const chunk = candidates.slice(i, i + CRAWL_CONCURRENCY)
    const fetched = await Promise.all(
      chunk.map(async (candidate) => {
        const html = await fetchHtml(candidate.url)
        return html ? { ...candidate, html } : null
      })
    )

    pages.push(...fetched.filter((page) => page !== null))
  }

  return pages
}

function getPageText($: cheerio.CheerioAPI): string | null {
  const text = ($('main').text() || $('body').text()).replace(/\s+/g, ' ').trim()
  return text || null
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
      const candidates = await discoverCandidates(landingHtml, url)
      const pages = await fetchCandidatePages(
        candidates.slice(0, ctx.maxCrawlPages ?? MAX_CRAWL_PAGES)
      )

      let socialLinks: SocialLinkFields = {
        socialInstagram: result.socialInstagram,
        socialThreads: result.socialThreads,
        socialFacebook: result.socialFacebook,
      }
      let categoryHints = result.categoryHints
      let description = result.description
      let story = result.story

      for (const page of pages) {
        const $ = cheerio.load(page.html)
        const pageResult = await singlePage.scrape(page.url, {
          ...ctx,
          prefetchedHtml: page.html,
        })

        socialLinks = mergeSocialLinks(socialLinks, extractSocialLinks($))
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
      }

      return {
        ...result,
        description,
        story,
        ...socialLinks,
        categoryHints,
      }
    } catch {
      return emptyResult(url)
    }
  }
}
