import * as cheerio from 'cheerio'
import { fetchHtml, fetchXml } from './fetch-guards'
import type { InputType } from './strategies/types'

const SOCIAL_HOSTS = [
  'instagram.com',
  'facebook.com',
  'threads.net',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'youtube.com',
  'pinterest.com',
]

const ECOMMERCE_HOSTS = [
  'pinkoi.com',
  'shopee.tw',
  'momo.com.tw',
  'rakuten.com.tw',
  'pchome.com.tw',
  'etsy.com',
  'amazon.com',
  'shopify.com',
]

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function classifyByDomain(url: string): InputType | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()

    if (SOCIAL_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
      return 'social'
    }

    if (ECOMMERCE_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
      return 'e-commerce'
    }

    return null
  } catch {
    return null
  }
}

function getDistinctInternalNavLinks(
  html: string,
  pageUrl: string,
  pageHostname: string
): string[] {
  const $ = cheerio.load(html)
  const links = new Set<string>()

  $('nav a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''

    try {
      const resolved = new URL(href, pageUrl)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return
      if (resolved.hostname.toLowerCase() !== pageHostname) return

      resolved.hash = ''
      links.add(`${resolved.pathname}${resolved.search}`)
    } catch {
      // Ignore malformed links.
    }
  })

  return [...links]
}

function countDistinctPathSections(paths: string[]): number {
  const sections = new Set<string>()

  for (const path of paths) {
    const section = path.split(/[/?#]/).find(Boolean)
    if (section) sections.add(section)
  }

  return sections.size
}

async function hasLargeSitemap(pageUrl: URL): Promise<boolean> {
  const sitemapUrl = new URL('/sitemap.xml', pageUrl.origin).href
  const sitemap = await fetchXml(sitemapUrl)
  const locCount = sitemap?.match(/<loc\b[^>]*>/gi)?.length ?? 0

  return locCount >= 3
}

export async function detectInputType(
  url: string,
  prefetchedHtml?: string | null
): Promise<InputType> {
  const domainType = classifyByDomain(url)
  if (domainType) return domainType

  try {
    const pageUrl = new URL(url)
    const html = prefetchedHtml ?? await fetchHtml(url)
    if (!html) return 'official-site'

    let score = 0

    if (await hasLargeSitemap(pageUrl)) {
      score += 2
    }

    const internalNavLinks = getDistinctInternalNavLinks(
      html,
      pageUrl.href,
      pageUrl.hostname.toLowerCase()
    )

    if (internalNavLinks.length >= 4) {
      score += 1
    }

    if (countDistinctPathSections(internalNavLinks) >= 2) {
      score += 1
    }

    return score >= 2 ? 'deep-multi-page' : 'official-site'
  } catch {
    return 'official-site'
  }
}
