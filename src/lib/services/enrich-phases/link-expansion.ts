/**
 * Deterministic pre-acquire expansion of hub pages (link-in-bio aggregators).
 *
 * A hub page (Linktree, Portaly, etc.) lists a brand's outbound links in one
 * place. This module discovers which of a brand's known URLs are hubs, fetches
 * them, and extracts purchase + social links — feeding the orchestrator a
 * scraped shape it can hand to `buildLinkEnrichPatch`.
 *
 * Pure and dependency-injected: no Supabase client, no direct fetch calls.
 */

import * as cheerio from 'cheerio'
import { isLinkAggregatorHost, isThirdPartyDirectoryHost } from './scraper/input-detector'
import {
  extractPurchaseLinks,
  extractSocialLinks,
  INSTAGRAM_PROFILE_RE,
} from './scraper/parse/extractors'
import {
  brandNameTokens,
  classifySubmittedUrl,
  handleMatchesBrand,
  linkIdentifiesBrand,
} from '../link-enrichment'
import type { FetchMetadata } from './scraper/fetch-guards'
import type { SourceOutcome } from '@/lib/types/curation'
import type { LinkField } from '@/lib/types/link-fields'

export type { SourceOutcome }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal brand shape consumed by this module — DB column names. */
export type LinkExpansionBrand = {
  website_url?: string | null
  other_urls?: unknown
  purchase_website?: string | null
  purchase_pinkoi?: string | null
  purchase_shopee?: string | null
  purchase_myship?: string | null
}

export type AdoptedLink = {
  field: LinkField
  value: string
  source: 'hub' | 'threads' | 'serp' | 'serp_handle'
  /** The page the link was read from — a hub page, or the Threads profile. */
  hubUrl: string
}

export type LinkExpansionResult = {
  hubsFetched: number
  /**
   * Hub pages that were fetched and came back empty. Adopting nothing from a
   * page that never loaded is not the same finding as adopting nothing from a
   * page that loaded and listed no store, and only this counter separates
   * them — the caller maps a non-zero count to `unknown`.
   */
  fetchFailures: number
  adopted: AdoptedLink[]
  scraped: Partial<Record<LinkField, string>>
  gated?: string[]
}

type ExpandLinkHubsInput = {
  brandName: string | null | undefined
  hubUrls: string[]
  confirmedHubUrls: ReadonlySet<string>
  fetchHtml: (url: string) => Promise<string | null>
}

export type ChannelSources = {
  hubs: SourceOutcome
  threads: SourceOutcome
  serpName: SourceOutcome
  serpHandle: SourceOutcome
}

export type ThreadsBioResult = {
  threads: SourceOutcome
  relMeUrl?: string
  hubUrls: string[]
  adopted: AdoptedLink[]
  scraped: Partial<Record<LinkField, string>>
  gated?: string[]
}

type ExpandThreadsBioInput = {
  brandName: string | null | undefined
  threadsUrl: string
  confirmedHubUrls: ReadonlySet<string>
  fetchHtmlWithMetadata: (url: string) => Promise<FetchMetadata>
  fetchHtml: (url: string) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Purchase-channel check
// ---------------------------------------------------------------------------

const PURCHASE_COLUMNS = [
  'purchase_website',
  'purchase_pinkoi',
  'purchase_shopee',
  'purchase_myship',
] as const

export function hasPurchaseChannel(brand: LinkExpansionBrand): boolean {
  return PURCHASE_COLUMNS.some((col) => {
    const v = brand[col]
    if (typeof v !== 'string' || v.length === 0) return false
    if (col === 'purchase_website') {
      return !isLinkAggregatorHost(v) && !isThirdPartyDirectoryHost(v)
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Hub URL collection
// ---------------------------------------------------------------------------

type OtherUrlEntry = { url?: string }

function parseOtherUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (entry): entry is OtherUrlEntry =>
        entry != null &&
        typeof entry === 'object' &&
        'url' in entry &&
        typeof (entry as OtherUrlEntry).url === 'string',
    )
    .map((entry) => entry.url!)
}

export function collectHubUrls(brand: LinkExpansionBrand): string[] {
  const candidates = [
    brand.website_url,
    ...parseOtherUrls(brand.other_urls),
    brand.purchase_website,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  const seen = new Set<string>()
  const hubs: string[] = []
  for (const url of candidates) {
    if (seen.has(url)) continue
    seen.add(url)
    if (isLinkAggregatorHost(url)) {
      hubs.push(url)
    }
  }
  return hubs
}

// ---------------------------------------------------------------------------
// Redirect wrapper unwrapping
// ---------------------------------------------------------------------------

/**
 * If any query-parameter value of `url` is itself a valid http(s) URL, return
 * that inner URL. Otherwise return the original. This strips one layer of
 * affiliate redirect wrappers (`affsrc.com/track/clicks?t=https://…`).
 */
export function unwrapRedirectWrapper(url: string): string {
  try {
    const params = new URL(url).searchParams
    for (const [, value] of params) {
      try {
        const inner = new URL(value)
        if (inner.protocol === 'http:' || inner.protocol === 'https:') {
          return inner.toString()
        }
      } catch {
        // not a URL — skip
      }
    }
  } catch {
    // malformed outer URL — return as-is
  }
  return url
}

// ---------------------------------------------------------------------------
// Hub expansion
// ---------------------------------------------------------------------------

/**
 * Social fields that require a brand-token identity gate — handles from a hub
 * page must plausibly belong to the brand before adoption.
 */
const SOCIAL_FIELDS: readonly LinkField[] = [
  'socialInstagram',
  'socialThreads',
  'socialFacebook',
]

function isPurchaseField(field: string): boolean {
  return field.startsWith('purchase')
}

export async function expandLinkHubs(
  input: ExpandLinkHubsInput,
): Promise<LinkExpansionResult> {
  const { brandName, hubUrls, confirmedHubUrls, fetchHtml } = input
  const tokens = brandNameTokens(brandName)
  const adopted: AdoptedLink[] = []
  const scraped: Partial<Record<LinkField, string>> = {}
  const gated: string[] = []
  let hubsFetched = 0
  let fetchFailures = 0

  for (const hubUrl of hubUrls) {
    hubsFetched++
    const html = await fetchHtml(hubUrl)
    if (!html) {
      fetchFailures++
      continue
    }

    const $ = cheerio.load(html)
    const purchaseLinks = extractPurchaseLinks($)
    const socialLinks = extractSocialLinks($)

    const isConfirmed =
      confirmedHubUrls.has(hubUrl) ||
      linkIdentifiesBrand(hubUrl, tokens)

    // Collect all anchor hrefs for classifySubmittedUrl fallback
    const allHrefs: string[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')
      if (href) allHrefs.push(href)
    })

    // Process purchase links
    for (const [field, rawValue] of Object.entries(purchaseLinks)) {
      if (!rawValue) continue
      const value = unwrapRedirectWrapper(rawValue)
      const linkField = field as LinkField

      if (!isPurchaseField(field)) continue

      if (isConfirmed) {
        if (!scraped[linkField]) {
          scraped[linkField] = value
          adopted.push({ field: linkField, value, source: 'hub', hubUrl })
        }
      } else {
        // Unconfirmed hub with purchase links — gate
        try {
          const host = new URL(hubUrl).hostname.toLowerCase().replace(/^www\./, '')
          const tag = `hub_unconfirmed:${host}`
          if (!gated.includes(tag)) gated.push(tag)
        } catch {
          // ignore
        }
      }
    }

    // Process social links
    for (const [field, rawValue] of Object.entries(socialLinks)) {
      if (!rawValue) continue
      const linkField = field as LinkField
      if (!SOCIAL_FIELDS.includes(linkField)) continue

      // Social handles must pass the brand-token gate
      if (!handleMatchesBrand(rawValue, tokens)) continue

      if (!scraped[linkField]) {
        scraped[linkField] = rawValue
        adopted.push({ field: linkField, value: rawValue, source: 'hub', hubUrl })
      }
    }

    // Also try classifySubmittedUrl on remaining hrefs for marketplace links
    // that extractPurchaseLinks might have missed (e.g. s.shopee.tw short URLs)
    for (const rawHref of allHrefs) {
      const href = unwrapRedirectWrapper(rawHref)
      const classified = classifySubmittedUrl(href)
      for (const [field, value] of Object.entries(classified)) {
        const linkField = field as LinkField
        if (scraped[linkField]) continue
        if (!value) continue

        if (isPurchaseField(field)) {
          if (isConfirmed) {
            scraped[linkField] = value
            adopted.push({ field: linkField, value, source: 'hub', hubUrl })
          } else {
            try {
              const host = new URL(hubUrl).hostname.toLowerCase().replace(/^www\./, '')
              const tag = `hub_unconfirmed:${host}`
              if (!gated.includes(tag)) gated.push(tag)
            } catch {
              // ignore
            }
          }
        } else if (SOCIAL_FIELDS.includes(linkField)) {
          if (!handleMatchesBrand(value, tokens)) continue
          scraped[linkField] = value
          adopted.push({ field: linkField, value, source: 'hub', hubUrl })
        }
      }
    }
  }

  return {
    hubsFetched,
    fetchFailures,
    adopted,
    scraped,
    ...(gated.length > 0 ? { gated } : {}),
  }
}

// ---------------------------------------------------------------------------
// Threads bio expansion
// ---------------------------------------------------------------------------

/**
 * The Threads profile URL implied by an Instagram profile URL.
 *
 * Meta issues one handle across both platforms, so a brand that stores only an
 * Instagram profile still has a Threads bio worth reading. Only a PROFILE URL
 * yields a handle: a post permalink's first path segment is `p` or `reel`, and
 * turning that into `@p` would fetch a stranger's page. Returns `null` for
 * anything that is not an Instagram profile.
 */
export function deriveThreadsUrl(
  instagramUrl: string | null | undefined,
): string | null {
  if (typeof instagramUrl !== 'string' || instagramUrl.length === 0) return null
  if (!INSTAGRAM_PROFILE_RE.test(instagramUrl)) return null

  const handle = /instagram\.com\/([^/?#]+)\/?$/i.exec(instagramUrl)?.[1]
  if (!handle) return null

  return `https://www.threads.com/@${handle}`
}

/**
 * The one place a fetch result becomes an outcome.
 *
 * Only a served 200 with a body is readable. Only a 404 proves the profile is
 * not there. EVERYTHING else — a null body, a 5xx, a 4xx that is not 404, a
 * timeout, an oversized response, a network error — is `unknown`, because the
 * finalizer hides brands on `absent`, and an outage that read as `absent` would
 * hide every brand in the cohort at once.
 */
function classifyFetchOutcome(
  metadata: FetchMetadata,
): 'readable' | 'absent' | 'unknown' {
  if (metadata.text && metadata.status === 200) return 'readable'
  if (metadata.status === 404) return 'absent'
  return 'unknown'
}

/** The platform's own signed-out landing page, not a brand profile. */
function isJoinThreadsLanding($: cheerio.CheerioAPI): boolean {
  const description =
    $('meta[property="og:description"]').attr('content') ??
    $('meta[name="og:description"]').attr('content') ??
    ''
  return description.trimStart().startsWith('Join Threads')
}

/**
 * Reads the single `rel="me"` link a brand puts in its Threads bio.
 *
 * Threads renders that link into the document head, so it survives without a
 * headless browser. The link is the brand's own declaration, so a purchase
 * destination behind it is trusted outright; a social handle behind it still
 * has to pass the brand-token gate, because a bio can link a collaborator.
 * When the link is itself an aggregator, the hub expander takes over and its
 * adoptions are re-tagged `threads` — the Threads profile is what vouched for
 * that hub, so the hub counts as confirmed.
 */
export async function expandThreadsBio(
  input: ExpandThreadsBioInput,
): Promise<ThreadsBioResult> {
  const {
    brandName,
    threadsUrl,
    confirmedHubUrls,
    fetchHtmlWithMetadata,
    fetchHtml,
  } = input

  const empty: ThreadsBioResult = {
    threads: 'unknown',
    hubUrls: [],
    adopted: [],
    scraped: {},
  }

  const metadata = await fetchHtmlWithMetadata(threadsUrl)
  const outcome = classifyFetchOutcome(metadata)
  if (outcome !== 'readable') {
    return { ...empty, threads: outcome }
  }

  const $ = cheerio.load(metadata.text!)
  if (isJoinThreadsLanding($)) {
    return { ...empty, threads: 'absent' }
  }

  const rawHref = $('link[rel="me"][href^="http"]').first().attr('href')
  if (!rawHref) {
    return { ...empty, threads: 'absent' }
  }

  const relMeUrl = unwrapRedirectWrapper(rawHref)

  if (isLinkAggregatorHost(relMeUrl)) {
    const hub = await expandLinkHubs({
      brandName,
      hubUrls: [relMeUrl],
      confirmedHubUrls: new Set([...confirmedHubUrls, relMeUrl]),
      fetchHtml,
    })

    const adopted = hub.adopted.map((link) => ({
      ...link,
      source: 'threads' as const,
    }))

    return {
      threads:
        adopted.length > 0
          ? 'found'
          : hub.fetchFailures > 0
            ? 'unknown'
            : 'absent',
      relMeUrl,
      hubUrls: [relMeUrl],
      adopted,
      scraped: hub.scraped,
      ...(hub.gated ? { gated: hub.gated } : {}),
    }
  }

  const tokens = brandNameTokens(brandName)
  const adopted: AdoptedLink[] = []
  const scraped: Partial<Record<LinkField, string>> = {}

  for (const [field, value] of Object.entries(classifySubmittedUrl(relMeUrl))) {
    if (!value) continue
    const linkField = field as LinkField
    if (scraped[linkField]) continue

    if (isPurchaseField(field)) {
      scraped[linkField] = value
      adopted.push({ field: linkField, value, source: 'threads', hubUrl: threadsUrl })
    } else if (SOCIAL_FIELDS.includes(linkField)) {
      if (!handleMatchesBrand(value, tokens)) continue
      scraped[linkField] = value
      adopted.push({ field: linkField, value, source: 'threads', hubUrl: threadsUrl })
    }
  }

  return {
    threads: adopted.length > 0 ? 'found' : 'absent',
    relMeUrl,
    hubUrls: [],
    adopted,
    scraped,
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const EVIDENCE_SOURCE_KEYS = [
  'hubs',
  'threads',
  'serpName',
  'serpHandle',
] as const

/**
 * Whether the channel search answered well enough to act on.
 *
 * `conclusive` requires all four sources to have recorded an answer, none of
 * them `unknown`, and every search call that was actually made to have
 * succeeded. Anything short of that is `inconclusive` — the pipeline may then
 * skip the brand, but it may never reject or hide one.
 */
export function computeEvidence(
  sources: Partial<ChannelSources> | undefined,
  serpCallStatuses: ReadonlyArray<string | null | undefined> = [],
): 'conclusive' | 'inconclusive' {
  if (!sources) return 'inconclusive'

  for (const key of EVIDENCE_SOURCE_KEYS) {
    const outcome = sources[key]
    if (outcome === undefined || outcome === 'unknown') return 'inconclusive'
  }

  for (const status of serpCallStatuses) {
    if (status == null) continue
    if (status !== 'succeeded') return 'inconclusive'
  }

  return 'conclusive'
}
