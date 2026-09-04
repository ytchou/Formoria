import * as cheerio from 'cheerio'
import { fetchHtml, fetchXml } from './fetch-guards'
import type { InputType } from './strategies/types'
import { identifyPlatform } from './platforms'

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
  'myship.7-11.com.tw',
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
  'portaly.cc',
]

/**
 * Delivery apps, review/travel sites, encyclopaedias, blogging platforms, and
 * site builders' own domains. None of them is ever a brand's own website — a
 * live run put `https://www.ubereats.com` into a tea brand's `purchase_website`
 * because the SERP ranked its delivery page first and nothing here rejected it.
 *
 * Kept OUT of `SOCIAL_HOSTS` / `ECOMMERCE_HOSTS` for the same reason
 * `LINK_AGGREGATOR_HOSTS` is: those two drive `classifyByDomain`, so a host in
 * either one changes how the URL is SCRAPED (`PlatformAdapterStrategy` instead
 * of the generic page strategy). These hosts must only affect whether a URL may
 * be ADOPTED as the brand's own site, never the scrape route.
 *
 * `youtube.com` is intentionally absent: it is already in `SOCIAL_HOSTS`.
 */
const NON_BRAND_PLATFORM_HOSTS = [
  // Food delivery / ordering
  'ubereats.com',
  'foodpanda.com',
  'foodpanda.com.tw',
  'deliveroo.com',
  // Reviews / travel / directories
  'tripadvisor.com',
  'tripadvisor.com.tw',
  'yelp.com',
  'wikipedia.org',
  'google.com',
  'maps.google.com',
  'goo.gl',
  'books.com.tw',
  // Trade-show / expo organiser. Every exhibiting brand's SERP carries its expo
  // listing, so this host recurs across the whole expo import and outranks the
  // small exhibitors themselves — it is never any of their own sites.
  'creativexpo.tw',
  // Convenience-store logistics and hosted checkout. A brand links these as a
  // *shipping option*, never as its own site, but they outrank a small brand's
  // domain often enough to be adopted as one — `https://myship.7-11.com.tw`
  // stood in as a tea brand's official website on a live run.
  // MyShip is deliberately duplicated in ECOMMERCE_HOSTS: that list selects
  // its scraper adapter, while this list blocks official-site adoption.
  'myship.7-11.com.tw',
  '7-11.com.tw',
  'ibon.com.tw',
  'family.com.tw',
  'famiport.com.tw',
  'ecpay.com.tw',
  'newebpay.com',
  'payuni.com.tw',
  // Publishing platforms and site builders (their own domain, not a brand's)
  'medium.com',
  'pixnet.net',
  'blogspot.com',
  'wordpress.com',
  'wix.com',
  'weebly.com',
]

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * True when the URL belongs to a link-in-bio aggregator (Linktree, Portaly,
 * etc.). Used by the link-expansion module to decide which of a brand's known
 * URLs are hub pages worth scraping for outbound links.
 *
 * The underlying `LINK_AGGREGATOR_HOSTS` array stays module-private — only this
 * predicate is exported.
 */
export function isLinkAggregatorHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return LINK_AGGREGATOR_HOSTS.some((domain) => hostnameMatches(hostname, domain))
  } catch {
    return false
  }
}

/**
 * True when the URL's host is a platform rather than a brand's own site: a
 * social network, a marketplace, a link aggregator, or one of the delivery /
 * directory / publishing platforms in `NON_BRAND_PLATFORM_HOSTS`.
 *
 * The read-side guard for every place a host stands in for the brand — the
 * `site:` image query and the `purchase_website` column. A malformed URL
 * returns false: unknown, not blocked.
 */
export function isNonBrandSiteHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return [
      ...SOCIAL_HOSTS,
      ...ECOMMERCE_HOSTS,
      ...LINK_AGGREGATOR_HOSTS,
      ...NON_BRAND_PLATFORM_HOSTS,
    ].some((domain) => hostnameMatches(hostname, domain))
  } catch {
    return false
  }
}

/**
 * True for a page that belongs to a third party rather than to any brand we
 * scrape it for — an expo organiser, a directory, a delivery app, a publishing
 * platform.
 *
 * The distinction that matters is with `LINK_AGGREGATOR_HOSTS`: a linktr.ee page
 * exists to list ONE brand's accounts, so harvesting its links is the whole
 * point. A `creativexpo.tw` exhibitor listing is the organiser's page — the
 * social links on it are the ORGANISER's, and adopting them put one illustrator's
 * Facebook page on 23 unrelated brands (DEV-1332). `NON_BRAND_PLATFORM_HOSTS`
 * previously only blocked official-website adoption; link harvesting is the
 * second way a third party's identity reaches a brand row.
 */
export function isThirdPartyDirectoryHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return NON_BRAND_PLATFORM_HOSTS.some((domain) =>
      hostnameMatches(hostname, domain),
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
  pageHostname: string,
): string[] {
  const $ = cheerio.load(html)
  const links = new Set<string>()

  $('nav a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''

    try {
      const resolved = new URL(href, pageUrl)
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')
        return
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
  prefetchedHtml?: string | null,
): Promise<InputType> {
  const domainType = classifyByDomain(url)
  if (domainType) return domainType

  const urlPlatform = identifyPlatform(url)
  if (
    urlPlatform === 'shopline' ||
    urlPlatform === '91app' ||
    urlPlatform === 'cyberbiz'
  ) {
    return 'e-commerce'
  }

  try {
    const pageUrl = new URL(url)
    const html = prefetchedHtml ?? (await fetchHtml(url))
    if (!html) return 'official-site'
    const htmlPlatform = identifyPlatform(url, html)
    if (
      htmlPlatform === 'shopline' ||
      htmlPlatform === '91app' ||
      htmlPlatform === 'cyberbiz'
    ) {
      return 'e-commerce'
    }

    let score = 0

    if (await hasLargeSitemap(pageUrl)) {
      score += 2
    }

    const internalNavLinks = getDistinctInternalNavLinks(
      html,
      pageUrl.href,
      pageUrl.hostname.toLowerCase(),
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
