import { normalizeToRootUrl } from '@/lib/url'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  brandNameTokens,
  buildLinkEnrichPatch,
  canonicalizeThreadsUrl,
  extractLinksFromUrls,
  hasLinkValue,
  hostMatchesBrandName,
  isInstitutionalHost,
  isForeignCountryTld,
  linkIdentifiesBrand,
  LINK_FIELDS,
  type LinkField,
  linkColumnFor,
  pageKey,
  pageKeyHost,
  sameUrl,
  scrapeKey,
} from '../link-enrichment'
import { cleanBrandName, isValidBrandName, titleCaseScrapedTitle } from '../brand-cleanup'
import { finishSearchAudit, startSearchAudit } from '../search-results'
import { MAX_SCRAPE_URLS_PER_BRAND, scrapeBrandUrls, type ScrapeBrandUrlsOptions } from './scraper'
import { classifyByDomain, isNonBrandSiteHost } from './scraper/input-detector'
import { mergeScrapedData } from './scraper/merge'
import type { PhaseResult } from '@/lib/types/curation'
import { auditedCall } from '@/lib/audit'
import type { ScrapedBrandData, ScrapedImageSource } from '@/lib/types/scraper'
import type { EnrichScrapedData } from './types'
import { brandTarget, type EnrichmentTarget } from '../_shared/enrichment-target'
import { buildPhaseResult, hasPatchValues, timePhase, type EnrichBrand, type EnrichPhase } from './types'
import { PURCHASE_CHANNELS } from '@/lib/brands/purchase-channels'

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

export type LinksPhaseOutput = {
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
  quarantine: Record<string, QuarantineGroup>
}

export type QuarantineGroup = {
  subjectUrl: string
  subjectKind: 'website' | 'source-page'
  columns: string[]
  evidence: {
    title?: string
    description?: string
    story?: string
  }
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
    (u) =>
      classifyByDomain(u) === null &&
      !isNonBrandSiteHost(u) &&
      !isForeignCountryTld(u) &&
      !isInstitutionalHost(u),
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
    purchase_myship: scrapedData.purchase_myship ?? scrapedData.purchaseMyship,
  }
}

// MyShip is discovered passively from scraped links; if yield stays low, gate a
// site:myship.7-11.com.tw Serper upgrade here instead of broadening the query.

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
 * This is the base tier: zero-token brands can add up to
 * MAX_ZERO_TOKEN_SOCIAL_URLS extras. The combined two-tier budget must stay
 * within MAX_SCRAPE_URLS_PER_BRAND or scrapeBrandUrls truncates silently.
 */
const MAX_SECOND_PASS_URLS = 3

/**
 * Extra social candidates for Han-only names, capped by
 * MAX_SCRAPE_URLS_PER_BRAND. Raise that budget if recall proves insufficient,
 * together with the guard below.
 */
const MAX_ZERO_TOKEN_SOCIAL_URLS = 2

const MAX_SECOND_PASS_CANDIDATES = MAX_SECOND_PASS_URLS + MAX_ZERO_TOKEN_SOCIAL_URLS
if (MAX_SECOND_PASS_CANDIDATES > MAX_SCRAPE_URLS_PER_BRAND) {
  throw new Error(
    `second-pass budget ${MAX_SECOND_PASS_CANDIDATES} exceeds MAX_SCRAPE_URLS_PER_BRAND ${MAX_SCRAPE_URLS_PER_BRAND}; scrapeBrandUrls would silently drop candidates`,
  )
}

/**
 * ORDER INVARIANT — `purchaseWebsite` must stay ahead of every marketplace
 * channel except the two below. The candidate list is truncated at
 * MAX_SECOND_PASS_URLS, so a channel slotted before the website silently
 * pushes the brand's own site — the highest-quality evidence source — out of
 * the pass entirely on exactly the sparse-link brands this pass exists for.
 * A newly added channel therefore lands in POST_WEBSITE_PURCHASE_CHANNELS by
 * default; only these two predate the website because they always have.
 * The budget is two-tier: MAX_SECOND_PASS_URLS base candidates plus up to
 * MAX_ZERO_TOKEN_SOCIAL_URLS extras for a zero-token brand. Their combined
 * total must stay within MAX_SCRAPE_URLS_PER_BRAND or scrapeBrandUrls truncates silently.
 */
const PRE_WEBSITE_PURCHASE_CHANNEL_KEYS: readonly string[] = ['pinkoi', 'shopee']

const PRE_WEBSITE_PURCHASE_CHANNELS = PURCHASE_CHANNELS.filter((channel) =>
  PRE_WEBSITE_PURCHASE_CHANNEL_KEYS.includes(channel.key),
)

const POST_WEBSITE_PURCHASE_CHANNELS = PURCHASE_CHANNELS.filter(
  (channel) =>
    channel.key !== 'website' && !PRE_WEBSITE_PURCHASE_CHANNEL_KEYS.includes(channel.key),
)

/**
 * Scraping the official site is *how* we learn a brand's Instagram, Facebook,
 * Pinkoi, Shopee, and MyShip URLs — but the first pass fixed its URL set before those
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
  urlExtracted: ReturnType<typeof extractLinksFromUrls>,
): Promise<ScrapedBrandData> {
  const alreadyScraped = new Set(
    firstPassUrls.slice(0, MAX_SCRAPE_URLS_PER_BRAND).map(pageKey),
  )
  const candidates = uniqueUrls(
    [
      firstPassData.socialInstagram,
      firstPassData.socialFacebook,
      ...PRE_WEBSITE_PURCHASE_CHANNELS.map((channel) => firstPassData[channel.camel]),
      firstPassData.purchaseWebsite,
      ...POST_WEBSITE_PURCHASE_CHANNELS.map((channel) => firstPassData[channel.camel]),
    ].filter(hasLinkValue),
  )
    .filter((url) => !alreadyScraped.has(pageKey(url)))
    .slice(0, MAX_SECOND_PASS_URLS)

  // Deduped against the base candidates BEFORE the slice: these two slots exist
  // to buy NEW evidence, so a URL already queued must not consume one.
  const candidateKeys = new Set(candidates.map(pageKey))
  const zeroTokenSocials =
    brandNameTokens(options.brandName).length === 0
      ? uniqueUrls(
          [
            urlExtracted.social_instagram,
            urlExtracted.social_threads,
            urlExtracted.social_facebook,
          ].filter(hasLinkValue),
        )
          .filter((url) => !alreadyScraped.has(pageKey(url)) && !candidateKeys.has(pageKey(url)))
          .slice(0, MAX_ZERO_TOKEN_SOCIAL_URLS)
      : []

  candidates.push(...zeroTokenSocials)

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

/**
 * Resolve, per link field, which page supplied the surviving value and whether
 * that page is confirmed to belong to the brand.
 *
 * Single-sourced because two callers need the same answer and must not drift:
 * `buildQuarantine` escalates what is NOT confirmed, and `buildLinkEnrichPatch`
 * exempts what IS confirmed from the DEV-1332 handle gate. If these disagreed,
 * a link could be dropped by the gate and simultaneously escalated as though it
 * had been adopted.
 */
function resolveFieldSources(
  brandName: string | undefined,
  knownUrls: string[],
  scrapedData: EnrichScrapedData,
  scrapedFromPages: EnrichScrapedData | null,
): Map<LinkField, { sourceUrl: string; isConfirmed: boolean }> {
  const confirmed = new Set(knownUrls.map(scrapeKey))
  const tokens = brandNameTokens(brandName)
  const resolved = new Map<LinkField, { sourceUrl: string; isConfirmed: boolean }>()

  for (const field of LINK_FIELDS) {
    const column = linkColumnFor(field)
    const value = scrapedData[column]
    if (typeof value !== 'string' || value.trim().length === 0) continue

    // `normalizeScrapedData` can overlay a SERP-derived snake_case value on a
    // camelCase value from the pages. Only trust page provenance when the page
    // actually supplied the value being judged; otherwise the SERP URL owns it.
    const provenanceUrl = scrapedData.linkProvenance?.[field]?.sourceUrl
    const fromPages = scrapedFromPages?.[field]
    const provenanceDescribesValue =
      typeof fromPages === 'string' && sameUrl(fromPages, value)
    const sourceUrl = provenanceUrl && provenanceDescribesValue ? provenanceUrl : value

    resolved.set(field, {
      sourceUrl,
      isConfirmed:
        confirmed.has(scrapeKey(sourceUrl)) || linkIdentifiesBrand(sourceUrl, tokens),
    })
  }

  return resolved
}

/** Fields whose source page is confirmed, for `buildLinkEnrichPatch`'s exemption. */
function confirmedIdentityFields(
  sources: Map<LinkField, { sourceUrl: string; isConfirmed: boolean }>,
): Set<LinkField> {
  const fields = new Set<LinkField>()
  for (const [field, source] of sources) {
    if (source.isConfirmed) fields.add(field)
  }
  return fields
}

function buildQuarantine(
  scrapedData: EnrichScrapedData,
  sources: Map<LinkField, { sourceUrl: string; isConfirmed: boolean }>,
  patch: Record<string, unknown>,
): Record<string, QuarantineGroup> {
  const groups: Record<string, QuarantineGroup> = {}

  // Per-source text first: a page that lost the first-wins merge race still has
  // its own title/description/story recorded, and that is the only evidence the
  // arbiter can judge it on. `textProvenance` stays as the fallback for scraped
  // data predating the per-source map — without evidence the arbiter releases.
  const byKey = new Map<string, NonNullable<ScrapedBrandData['perSourceText']>[string]>()
  const byHost = new Map<string, NonNullable<ScrapedBrandData['perSourceText']>[string]>()
  for (const [sourceUrl, text] of Object.entries(scrapedData.perSourceText ?? {})) {
    byKey.set(pageKey(sourceUrl), text)
    const host = pageKeyHost(sourceUrl)
    const existing = byHost.get(host) ?? {}
    for (const field of ['title', 'description', 'story'] as const) {
      const value = text[field]
      if (existing[field] === undefined && typeof value === 'string' && value.trim().length > 0) {
        existing[field] = value
      }
    }
    byHost.set(host, existing)
  }

  const textForSubject = (
    field: 'brandName' | 'description' | 'story',
    subjectUrl: string,
    subjectKind: 'website' | 'source-page',
  ): string | undefined => {
    const text = subjectKind === 'website'
      ? byHost.get(pageKeyHost(subjectUrl))
      : byKey.get(pageKey(subjectUrl))
    const sourceText = text?.[field === 'brandName' ? 'title' : field]
    if (typeof sourceText === 'string' && sourceText.trim().length > 0) return sourceText

    const provenanceUrl = scrapedData.textProvenance?.[field]?.sourceUrl
    const provenanceMatches = provenanceUrl && (subjectKind === 'website'
      ? pageKeyHost(provenanceUrl) === pageKeyHost(subjectUrl)
      : sameUrl(provenanceUrl, subjectUrl))
    if (provenanceMatches) {
      const winningText = scrapedData[field]
      if (typeof winningText === 'string' && winningText.trim().length > 0) return winningText
    }

    return undefined
  }

  for (const [field, source] of sources) {
    const column = linkColumnFor(field)
    const value = scrapedData[column]
    if (typeof value !== 'string' || value.trim().length === 0) continue
    if (source.isConfirmed) continue

    // Only escalate a value this run actually adopted. DEV-1332's handle gate
    // can decline a scraped social before it reaches the patch; escalating it
    // anyway would let a verdict about a page we never took a value from clear
    // the brand's STORED handle via `_cleared_fields`.
    if (!Object.hasOwn(patch, column)) continue

    const subjectUrl = source.sourceUrl
    const subjectKind = field === 'purchaseWebsite' ? 'website' : 'source-page'
    const existing = groups[subjectUrl]
    const evidence: QuarantineGroup['evidence'] = {}
    const evidenceFields = [
      ['brandName', 'title'],
      ['description', 'description'],
      ['story', 'story'],
    ] as const
    for (const [fieldName, evidenceName] of evidenceFields) {
      const value = textForSubject(fieldName, subjectUrl, subjectKind)
      if (value) evidence[evidenceName] = value
    }

    if (existing) {
      if (!existing.columns.includes(column)) existing.columns.push(column)
      if (existing.subjectKind !== 'website' && subjectKind === 'website') {
        existing.subjectKind = subjectKind
      }
      Object.assign(existing.evidence, evidence)
    } else {
      groups[subjectUrl] = { subjectUrl, subjectKind, columns: [column], evidence }
    }
  }

  return groups
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
      quarantine: {},
    }
  }

  return auditedCall(
    { provider: 'enrich', operation: 'runLinksPhase', kind: 'service' },
    async () => {
  const { result, durationMs } = await timePhase(async () => {
    const urls = prioritizeScrapeUrls(uniqueUrls([...knownUrls, ...discoveredUrls]))
    // These URLs are raw SERP results, so the brand name is the only thing
    // separating this brand's accounts from a same-ranking stranger's.
    const urlExtracted = extractLinksFromUrls(discoveredUrls, brand.name)
    const confirmedSourceUrls = new Set(knownUrls.map(scrapeKey))
    const scrapeOptions: ScrapeBrandUrlsOptions = {
      brandName: brand.name,
      confirmedSourceUrls,
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
    const scrapedFromPages: EnrichScrapedData = firstPass
      ? await scrapeDiscoveredLinks(firstPass.data, urls, scrapeOptions, urlExtracted)
      : ({} as EnrichScrapedData)
    const derivedWebsite = scrapedFromPages.purchaseWebsite ?? deriveOfficialWebsite(urls, brand.name)
    const scrapedData = normalizeScrapedData({
      ...scrapedFromPages,
      ...urlExtracted,
      purchaseWebsite: derivedWebsite,
    })
    // Resolved once and shared: the patch gate exempts a confirmed source page
    // from DEV-1332's handle test, and the quarantine escalates the rest.
    const fieldSources = resolveFieldSources(brand.name, knownUrls, scrapedData, scrapedFromPages)
    // `buildLinkEnrichPatch` is typed to link columns only, and that is now the
    // whole patch: the scraped name leaves this phase as a CANDIDATE, never as a
    // patch key, because `names` is the single writer of `name` (DEV-1321).
    const patch: Record<string, unknown> = buildLinkEnrichPatch(
      brand,
      scrapedData,
      brand.name,
      confirmedIdentityFields(fieldSources),
    )
    const scrapedBrandName = deriveScrapedBrandName(brand, scrapedData)
    return {
      patch,
      scrapedBrandName,
      scrapedData,
      scrapedImageUrls: scrapedData.galleryImageUrls ?? [],
      scrapedImageSources: scrapedData.imageSources ?? [],
      jsonLdImageUrls: scrapedData.jsonLdImageUrls ?? [],
      scrapedFromPages,
      fieldSources,
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
    quarantine: buildQuarantine(result.scrapedData, result.fieldSources, result.patch),
  }
    },
    {
      classify: (result) =>
        result.phaseResult.status === 'skipped' ? 'empty' : 'succeeded',
    },
  )
}
