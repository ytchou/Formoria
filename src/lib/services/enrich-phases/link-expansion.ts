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
import { isLinkAggregatorHost } from './scraper/input-detector'
import {
  extractPurchaseLinks,
  extractSocialLinks,
} from './scraper/parse/extractors'
import {
  brandNameTokens,
  classifySubmittedUrl,
  handleMatchesBrand,
  linkIdentifiesBrand,
} from '../link-enrichment'
import type { LinkField } from '@/lib/types/link-fields'

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
  source: 'hub'
  hubUrl: string
}

export type LinkExpansionResult = {
  hubsFetched: number
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
    return typeof v === 'string' && v.length > 0
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

  for (const hubUrl of hubUrls) {
    hubsFetched++
    const html = await fetchHtml(hubUrl)
    if (!html) continue

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
    adopted,
    scraped,
    ...(gated.length > 0 ? { gated } : {}),
  }
}
