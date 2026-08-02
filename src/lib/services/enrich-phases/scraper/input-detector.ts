import * as cheerio from 'cheerio'
import { fetchHtml, fetchXml } from './fetch-guards'
import type { InputType } from './strategies/types'

const SOCIAL_HOSTS = [
  'instagram.com',
  'facebook.com',
  // Meta moved Threads to threads.com and threads.net now redirects there, so
  // threads.com is canonical — but both must classify as social. Stored rows
  // and links in the wild still carry the old host, and a threads.net URL that
  // fell through here was treated as a brand's own official website.
  'threads.net',
  'threads.com',
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

/**
 * Link-in-bio aggregators. These are NOT a brand's own site, but they are
 * deliberately kept out of `SOCIAL_HOSTS` and `ECOMMERCE_HOSTS` — do not "tidy"
 * them in there.
 *
 * Membership in those two arrays makes `classifyByDomain` return non-null,
 * which routes the URL through `selectStrategy` to `PlatformAdapterStrategy`.
 * That strategy looks for a matching adapter, finds none for an aggregator, and
 * returns `emptyResult()` — we would extract ZERO links from exactly the pages
 * whose only purpose is to list a brand's links. Classifying as `null` instead
 * routes them to `SinglePageStrategy`, which runs `extractSocialLinks` /
 * `extractPurchaseLinks` and harvests the real URLs.
 *
 * `isNonBrandSiteHost` is therefore the only consumer: it keeps an aggregator
 * out of `purchase_website` and out of `site:` search filters while leaving the
 * scrape path untouched.
 */
const LINK_AGGREGATOR_HOSTS = [
  'linktr.ee',
  'lit.link',
  'biosites.com',
  'bio.site',
  'beacons.ai',
  'taplink.cc',
  'potato.link',
  'carrd.co',
  'bento.me',
  'solo.to',
  'allmylinks.com',
  'msha.ke',
]

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * True when the URL's host is a platform rather than a brand's own site: a
 * social network, a marketplace, or a link aggregator.
 *
 * The read-side guard for every place a host stands in for the brand — the
 * `site:` image query and the `purchase_website` column. A malformed URL
 * returns false: unknown, not blocked.
 */
export function isNonBrandSiteHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return [...SOCIAL_HOSTS, ...ECOMMERCE_HOSTS, ...LINK_AGGREGATOR_HOSTS].some((domain) =>
      hostnameMatches(hostname, domain)
    )
  } catch {
    return false
  }
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
