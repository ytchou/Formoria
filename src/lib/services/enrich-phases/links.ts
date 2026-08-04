import { normalizeToRootUrl } from '@/lib/url'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  brandNameTokens,
  buildLinkEnrichPatch,
  canonicalizeThreadsUrl,
  extractLinksFromUrls,
  hasLinkValue,
} from '../link-enrichment'
import { cleanBrandName, isValidBrandName, titleCaseScrapedTitle } from '../brand-cleanup'
import { finishSearchAudit, startSearchAudit } from '../search-results'
import { MAX_SCRAPE_URLS_PER_BRAND, scrapeBrandUrls, type ScrapeBrandUrlsOptions } from './scraper'
import { classifyByDomain, isNonBrandSiteHost } from './scraper/input-detector'
import { mergeScrapedData } from './scraper/merge'
import type { PhaseResult } from '@/lib/types/curation'
import type { ScrapedBrandData, ScrapedImageSource } from '@/lib/types/scraper'
import type { EnrichScrapedData } from './types'
import { brandTarget, type EnrichmentTarget } from '../_shared/enrichment-target'
import { buildPhaseResult, hasPatchValues, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type LinksPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  discoveredUrls: string[]
  knownUrls: string[]
  dryRun?: boolean
  target?: EnrichmentTarget
  jobId?: string
  supabase?: SupabaseClient<Database>
}

type LinksPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  /**
   * The brand's own page title, cleaned. Emitted as the `scraped` candidate for
   * the DEV-1321 names phase rather than written to `name` here — a raw page
   * title is how `首頁 - 小朱甜點` reached a live row, and `name` now has
   * exactly one writer.
   */
  scrapedBrandName: string | null
  scrapedData: EnrichScrapedData | null
  scrapedImageUrls: string[]
  /** Parallel provenance for `scrapedImageUrls`; empty when the scraper predates it. */
  scrapedImageSources: ScrapedImageSource[]
  jsonLdImageUrls: string[]
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const url of urls) {
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

/**
 * Round-robins official / social / marketplace so every kind is represented
 * before any kind repeats. Each kind runs a different adapter and yields a
 * different set of images, so within a fixed URL budget breadth beats depth:
 * the old order (one official, then *all* social, then marketplace) meant a
 * brand with two social profiles exhausted the budget before its Pinkoi or
 * Shopee page — the two pages the richest adapters read — was ever fetched.
 */
function prioritizeScrapeUrls(urls: string[]): string[] {
  const official: string[] = []
  const social: string[] = []
  const marketplace: string[] = []
  for (const url of urls) {
    const classification = classifyByDomain(url)
    if (classification === null) official.push(url)
    else if (classification === 'social') social.push(url)
    else marketplace.push(url)
  }

  const buckets = [official, social, marketplace]
  const deepest = Math.max(...buckets.map((bucket) => bucket.length))
  const ordered: string[] = []
  for (let index = 0; index < deepest; index += 1) {
    for (const bucket of buckets) {
      const url = bucket.at(index)
      if (url) ordered.push(url)
    }
  }

  return ordered
}

/**
 * Public-suffix labels we strip before looking for the brand's name in a host,
 * so a brand token never matches the TLD itself. Not a full PSL — the list only
 * needs to cover the suffixes Taiwanese brands actually register under.
 */
const PUBLIC_SUFFIX_SECOND_LEVELS = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'idv'])

/** The name-bearing labels of a host: `www.cha-tzu.com.tw` -> `chatzu`. */
function domainNameLabels(hostname: string): string {
  const labels = hostname.replace(/^www\./, '').split('.').filter(Boolean)
  let end = labels.length - 1
  if (end > 0 && PUBLIC_SUFFIX_SECOND_LEVELS.has(labels.at(end - 1) ?? '')) {
    end -= 1
  }
  return labels.slice(0, Math.max(end, 1)).join('').replace(/[^a-z0-9]/g, '')
}

/**
 * Two-letter TLDs a Taiwanese brand plausibly registers under. `tw` is the home
 * ccTLD; `co` and `io` are two-letter by accident of the DNS and are used as
 * generic startup TLDs worldwide, Taiwan included.
 */
const ALLOWED_TWO_LETTER_TLDS = new Set(['tw', 'co', 'io'])

/**
 * True for a host under a foreign country's ccTLD.
 *
 * This is a Taiwan-only brand directory, and a SERP for a short Latin brand name
 * routinely surfaces a same-named foreign company: `https://onewood.dk`, a
 * Danish firm, became the Taiwanese brand "One Wood"'s official website on a
 * live run, and it passed every guard we had — the host is not a platform, and
 * the domain does carry the brand's tokens, because the two companies genuinely
 * share a name. Nationality is the only signal that separates them.
 *
 * Only two-letter TLDs are judged: every generic TLD (`.com`, `.shop`,
 * `.store`, `.design`, `.studio`, …) is registrable from Taiwan and says nothing
 * about nationality, so those pass untouched. `.com.tw` ends in `tw` and passes.
 * A malformed URL is not rejected here — unknown, not blocked, matching
 * `isNonBrandSiteHost`.
 */
function isForeignCountryTld(url: string): boolean {
  try {
    const tld = new URL(url).hostname.toLowerCase().split('.').at(-1) ?? ''
    return tld.length === 2 && !ALLOWED_TWO_LETTER_TLDS.has(tld)
  } catch {
    return false
  }
}

function hostMatchesBrandName(url: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false
  try {
    const domain = domainNameLabels(new URL(url).hostname.toLowerCase())
    return tokens.some((token) => domain.includes(token))
  } catch {
    return false
  }
}

/**
 * The brand's own site among the SERP URLs, normalised to its root. This is what
 * puts a brand's domain into `purchase_website`, and the batch image-search
 * phase — which now runs AFTER this one — reads that value out of this phase's
 * patch to build its `site:` query.
 *
 * Eligibility alone is not enough to identify a brand: "first URL that is not a
 * platform" made `https://www.ubereats.com` a tea brand's official website,
 * because its delivery page outranked the brand's own domain. So prefer a host
 * that plausibly belongs to the brand — one whose registrable domain carries a
 * Latin token of the brand name. Pure function; `brandName` is optional so
 * callers without one keep the original behaviour exactly.
 *
 * When the name DOES yield tokens and no eligible host carries one, the answer
 * is null, not first-eligible. That fallback is how `https://www.nahoku.com` —
 * a Hawaiian jewellery company — became NU Dream Jewelry's official website,
 * and how `https://myship.7-11.com.tw`, a convenience-store shipping page,
 * became a tea brand's. A brand with no
 * site of its own is the common case here; the correct representation of it is
 * an empty column, not the SERP's first non-platform result. Only a name with
 * no Latin tokens at all (a purely Han name, which cannot fingerprint a domain)
 * still falls back, because for those we have nothing to discriminate with.
 *
 * Exported for its unit tests: the aggregator and Threads cases below guard a
 * production bug where a platform host was adopted as a brand's own site.
 *
 * Eligibility also excludes foreign ccTLDs (`isForeignCountryTld`), which is
 * what keeps a same-named company abroad out of a Taiwan-only directory — it
 * applies to the token-matched and the fallback path alike, since a name match
 * is exactly what a same-named foreign company produces.
 *
 * `classifyByDomain` alone is not enough: link aggregators deliberately
 * classify as `null` so the scraper harvests their links (see
 * `LINK_AGGREGATOR_HOSTS`), which also made a linktr.ee URL eligible to become
 * the brand's "official website". `isNonBrandSiteHost` is the wider test.
 */
export function deriveOfficialWebsite(urls: string[], brandName?: string | null): string | null {
  const eligible = urls.filter(
    (u) => classifyByDomain(u) === null && !isNonBrandSiteHost(u) && !isForeignCountryTld(u),
  )
  const tokens = brandNameTokens(brandName)
  const matched = eligible.find((u) => hostMatchesBrandName(u, tokens))
  const url = matched ?? (tokens.length > 0 ? null : eligible.at(0))
  return normalizeToRootUrl(url ?? null)
}

function normalizeScrapedData(scrapedData: EnrichScrapedData): EnrichScrapedData {
  const socialThreads = scrapedData.social_threads ?? scrapedData.socialThreads
  const purchaseWebsite = scrapedData.purchase_website ?? scrapedData.purchaseWebsite
  // threads.net redirects to threads.com; store the destination.
  const canonicalThreads = hasLinkValue(socialThreads)
    ? canonicalizeThreadsUrl(socialThreads)
    : socialThreads
  // A platform host is not the brand's own site, and downstream phases read
  // this value as one — the image search turns it into `site:{host} {name}`.
  const brandWebsite =
    hasLinkValue(purchaseWebsite) && isNonBrandSiteHost(purchaseWebsite) ? null : purchaseWebsite

  return {
    ...scrapedData,
    social_instagram: scrapedData.social_instagram ?? scrapedData.socialInstagram,
    social_threads: canonicalThreads,
    socialThreads: canonicalThreads,
    social_facebook: scrapedData.social_facebook ?? scrapedData.socialFacebook,
    purchase_website: brandWebsite,
    purchaseWebsite: brandWebsite,
    purchase_pinkoi: scrapedData.purchase_pinkoi ?? scrapedData.purchasePinkoi,
    purchase_shopee: scrapedData.purchase_shopee ?? scrapedData.purchaseShopee,
  }
}

function boundedScrapeSnippets(extracted: unknown): string[] {
  if (typeof extracted !== 'object' || extracted === null || Array.isArray(extracted)) return []
  const record = extracted as Record<string, unknown>
  return [record.description, record.story, record.stockistPageText]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.slice(0, 4_000))
}

/**
 * A brand's own site is the most authoritative source for its name, and the
 * scraper has always extracted it into `scrapedData.brandName` — it was simply
 * never consumed, so `adela.tw` handed us its full bilingual page title —
 * brand name, separator, and marketing tagline — on every run, and we discarded
 * it while the record stayed the bare uppercase `ADELA`.
 *
 * Only an addition is accepted: the cleaned title must still contain the name
 * we already hold, so `ADELA` can grow into its cased bilingual form but a page
 * title naming a different company cannot rebrand the record. `isValidBrandName`
 * adds the length and SEO-copy guards the detect phase already relies on.
 *
 * The result is no longer written to `name` here: it is the `scraped` candidate
 * the batched names phase arbitrates (DEV-1321). That phase runs immediately
 * after this one and before the batch image search, so an accepted name still
 * reaches this run's image query as well as the DB.
 */
export function deriveScrapedBrandName(
  brand: Pick<EnrichBrand, 'name'>,
  scrapedData: Pick<EnrichScrapedData, 'brandName'>
): string | null {
  const current = brand.name?.trim()
  const raw = scrapedData.brandName?.trim()
  if (!current || !raw) return null

  const cleaned = titleCaseScrapedTitle(cleanBrandName(raw).cleanedName.trim())
  if (!cleaned || cleaned === current) return null
  if (!isValidBrandName(cleaned, current)) return null
  // Additive only: the scraped name must still carry the existing one.
  if (!cleaned.toLowerCase().includes(current.toLowerCase())) return null
  if (cleaned.length <= current.length) return null

  return cleaned
}

/**
 * Bound on the follow-up scrape. Small on purpose: the point is to reach the
 * one or two profiles the official site just revealed, not to crawl outward.
 */
const MAX_SECOND_PASS_URLS = 3

/** Identity for "did we already scrape this?" — scheme, `www.`, and a trailing slash are noise. */
function scrapeKey(url: string): string {
  const trimmed = url.trim().toLowerCase()
  try {
    const parsed = new URL(trimmed)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/**
 * Scraping the official site is *how* we learn a brand's Instagram, Facebook,
 * Pinkoi, and Shopee URLs — but the first pass fixed its URL set before those
 * existed, so those links were written to the row and then scraped for the
 * first time only on the *next* enrichment run. That cost a whole cycle before
 * the free, higher-quality platform-adapter images were reachable, and 119 of
 * 599 approved brands have Instagram as their only URL.
 *
 * Exactly one extra pass, never recursive: this is a plain function that issues
 * a single `scrapeBrandUrls` call and returns, so a URL discovered by the
 * second pass waits for the next run rather than expanding the frontier here.
 * The audit callback is the same one the first pass uses, so these fetches land
 * in the trail identically.
 */
async function scrapeDiscoveredLinks(
  firstPassData: ScrapedBrandData,
  firstPassUrls: string[],
  options: ScrapeBrandUrlsOptions,
): Promise<ScrapedBrandData> {
  const alreadyScraped = new Set(
    firstPassUrls.slice(0, MAX_SCRAPE_URLS_PER_BRAND).map(scrapeKey),
  )
  const candidates = uniqueUrls(
    [
      firstPassData.socialInstagram,
      firstPassData.socialFacebook,
      firstPassData.purchasePinkoi,
      firstPassData.purchaseShopee,
      firstPassData.purchaseWebsite,
    ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0),
  )
    .filter((url) => !alreadyScraped.has(scrapeKey(url)))
    .slice(0, MAX_SECOND_PASS_URLS)

  if (candidates.length === 0) return firstPassData

  const secondPass = await scrapeBrandUrls(candidates, options)
  // Merged through the same helper the first pass uses, with the first pass at
  // the highest precedence: a follow-up profile may fill gaps but must never
  // overwrite what the brand's own site already told us.
  return mergeScrapedData([
    { type: 'official-site', data: firstPassData },
    { type: 'social', data: secondPass.data },
  ])
}

export async function runLinksPhase({
  brand,
  phases,
  discoveredUrls,
  knownUrls,
  dryRun = false,
  target,
  jobId,
  supabase,
}: LinksPhaseOptions): Promise<LinksPhaseOutput> {
  if (!phases.includes('links')) {
    return {
      phaseResult: buildPhaseResult('links', 'skipped', [], 0, undefined, 'links phase not requested'),
      patch: {},
      scrapedBrandName: null,
      scrapedData: null,
      scrapedImageUrls: [],
      scrapedImageSources: [],
      jsonLdImageUrls: [],
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const urls = prioritizeScrapeUrls(uniqueUrls([...knownUrls, ...discoveredUrls]))
    // These URLs are raw SERP results, so the brand name is the only thing
    // separating this brand's accounts from a same-ranking stranger's.
    const urlExtracted = extractLinksFromUrls(discoveredUrls, brand.name)
    const scrapeOptions: ScrapeBrandUrlsOptions = {
      onAttempt: async ({ url, classification, spanId }) => {
        const auditId = await startSearchAudit({
          target: target ?? brandTarget(brand.id),
          ...(jobId ? { jobId } : {}),
          supabase,
          // Joins this deep-store row to the scraper.scrape_url span wrapping
          // the same attempt. Without it the span and the row both exist but
          // cannot be correlated - the state that made the scrape path
          // invisible to the audit index (34 deep-store writes, 2 spans).
          auditSpanId: spanId,
          provider: 'scraper',
          endpoint: url,
          searchType: 'scrape',
          query: url,
          input: { url, classification },
          config: { phase: 'links', dryRun },
        })
        return {
          finish: async (attempt) => {
            await finishSearchAudit(
              auditId,
              {
                callStatus: attempt.callStatus,
                httpStatus: attempt.httpStatus,
                error: attempt.error,
                latencyMs: attempt.latencyMs,
                rawResponse: {
                  url,
                  classification,
                  ...(typeof attempt.extracted === 'object' &&
                  attempt.extracted !== null &&
                  !Array.isArray(attempt.extracted)
                    ? attempt.extracted
                    : { extracted: attempt.extracted }),
                },
                urls: [url],
                snippets: boundedScrapeSnippets(attempt.extracted),
                supabase,
              },
            )
          },
        }
      },
    }
    const firstPass = urls.length > 0 ? await scrapeBrandUrls(urls, scrapeOptions) : null
    const scraped: EnrichScrapedData = firstPass
      ? await scrapeDiscoveredLinks(firstPass.data, urls, scrapeOptions)
      : ({} as EnrichScrapedData)
    const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls, brand.name)
    const scrapedData = normalizeScrapedData({
      ...scraped,
      ...urlExtracted,
      purchaseWebsite: derivedWebsite,
    })
    // `buildLinkEnrichPatch` is typed to link columns only, and that is now the
    // whole patch: the scraped name leaves this phase as a CANDIDATE, never as a
    // patch key, because `names` is the single writer of `name` (DEV-1321).
    const patch: Record<string, unknown> = buildLinkEnrichPatch(brand, scrapedData)
    const scrapedBrandName = deriveScrapedBrandName(brand, scrapedData)
    return {
      patch,
      scrapedBrandName,
      scrapedData,
      scrapedImageUrls: scrapedData.galleryImageUrls ?? [],
      scrapedImageSources: scrapedData.imageSources ?? [],
      jsonLdImageUrls: scrapedData.jsonLdImageUrls ?? [],
    }
  })

  const changedFields = Object.keys(result.patch)
  const status = hasPatchValues(result.patch) ? 'succeeded' : 'skipped'

  return {
    phaseResult: buildPhaseResult('links', status, changedFields, durationMs),
    patch: result.patch,
    scrapedBrandName: result.scrapedBrandName,
    scrapedData: result.scrapedData,
    scrapedImageUrls: result.scrapedImageUrls,
    scrapedImageSources: result.scrapedImageSources,
    jsonLdImageUrls: result.jsonLdImageUrls,
  }
}
