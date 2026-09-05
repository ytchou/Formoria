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
import {
  canonicalizeBilingualBrandName,
  cleanBrandName,
  isValidBrandName,
  titleCaseScrapedTitle,
} from '../brand-cleanup'
import type { NameCandidate } from '../name-arbiter'
import { finishSearchAudit, startSearchAudit } from '../search-results'
import { MAX_SCRAPE_URLS_PER_BRAND, scrapeBrandUrls, type ScrapeBrandUrlsOptions } from './scraper'
import { classifyByDomain, isNonBrandSiteHost } from './scraper/input-detector'
import { mergeScrapedData } from './scraper/merge'
import type { PhaseResult } from '@/lib/types/curation'
import { MAX_IMAGE_POOL_BYTES, compactToBytes } from '../phase-results'
import { auditedCall } from '@/lib/audit'
import type { ScrapedBrandData, ScrapedImageSource } from '@/lib/types/scraper'
import type { EnrichScrapedData } from './types'
import { brandTarget, type EnrichmentTarget } from '../_shared/enrichment-target'
import {
  buildPhaseResult,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPatch,
  type EnrichPhase,
} from './types'
import { ONLINE_STORES } from '@/lib/brands/online-stores'
import type { RenderProvider } from './scraper/render/types'
import { bindBrandKey } from './scraper/render/render-budget'
import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'
import { createServiceClient } from '@/lib/supabase/service'
import { createAgentModel as defaultCreateAgentModel } from './agents/runtime'
import { buildCandidatePool, type CandidateImage } from './candidate-pool'
import {
  applyPlannedImageWrites as defaultApplyPlannedImageWrites,
  classifyStoredImages as defaultClassifyStoredImages,
  finalizeHeroOrder as defaultFinalizeHeroOrder,
  type ClassifiedImage,
  type PlannedImageWrite,
} from './classify-images'
import {
  discoverCatalog as defaultDiscoverCatalog,
  type CatalogDiscoveryResult,
} from './catalog-discovery'
import { downloadAndStoreImages as defaultDownloadAndStoreImages } from '../image-download'
import { buildChannelSources } from './images'
import { rank, resolveSourceUrl, type RankableImage } from './image-ranking'
import {
  batchSearchBrandImages as defaultBatchSearchBrandImages,
  searchBrandUrls as defaultSearchBrandUrls,
} from './scraper/search'
import type { ImageQueryInput } from './scraper/types'
import type { SerperAuditOptions } from './scraper/serper'
import { siteIdentityKey } from '../site-identity-arbiter'
import {
  applyRevocation,
  resolveQuarantine,
  verdictsFromCritique,
  type RevokableImagePayload,
} from './site-identity'

/**
 * Dependency overrides. Production supplies none of them; the unit tests inject
 * fakes here rather than mocking the service modules, which
 * `scripts/check-test-boundaries.mjs` refuses. Same shape as the override
 * `runBrandImagePhase` already carries for `discoverCatalog`.
 */
export type AcquireDeps = {
  runAcquisition?: typeof import('./acquisition/graph').runAcquisition
  createAgentModel?: typeof defaultCreateAgentModel
  downloadAndStoreImages?: typeof defaultDownloadAndStoreImages
  classifyStoredImages?: typeof defaultClassifyStoredImages
  applyPlannedImageWrites?: typeof defaultApplyPlannedImageWrites
  finalizeHeroOrder?: typeof defaultFinalizeHeroOrder
  discoverCatalog?: typeof defaultDiscoverCatalog
  searchBrandUrls?: typeof defaultSearchBrandUrls
  batchSearchBrandImages?: typeof defaultBatchSearchBrandImages
}

type AcquirePhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  discoveredUrls: string[]
  knownUrls: string[]
  dryRun?: boolean
  target?: EnrichmentTarget
  jobId?: string
  supabase?: SupabaseClient<Database>
  renderProvider?: RenderProvider
  deps?: AcquireDeps
  /** Multiplier for the per-brand time budget. >1 grants more time. */
  budgetScale?: number
  /** Link-expansion summary from the pre-acquire step, persisted on the phase result. */
  linkExpansion?: PhaseResult['linkExpansion']
}

export type AcquirePhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  /**
   * The brand's own page title, cleaned. Emitted as the `scraped` candidate for
   * the DEV-1321 names phase rather than written to `name` here — a raw page
   * title is how `首頁 - 小朱甜點` reached a live row, and `name` now has
   * exactly one writer.
   */
  scrapedBrandName: string | null
  /** Name candidates observed only on URLs already stored as first-party. */
  officialNameCandidates: NameCandidate[]
  scrapedData: EnrichScrapedData | null
  scrapedImageUrls: string[]
  /** Parallel provenance for `scrapedImageUrls`; empty when the scraper predates it. */
  scrapedImageSources: ScrapedImageSource[]
  jsonLdImageUrls: string[]
  quarantine: Record<string, QuarantineGroup>
  /** Present when the acquisition agent ran successfully. */
  acquisitionPlan?: AcquisitionPlanType | null
  /**
   * Every image this run classified, ranked for the 4:3 hero frame. The FULL
   * verdict per image, in memory only — the products agent ranks it a second
   * time against each proposal's page. `PhaseResult.imagePool` carries the
   * compact persisted summary instead.
   */
  imagePool: RankableImage[]
  /** Product pages the agent's catalog discovery found, for the products phase. */
  catalogResult?: CatalogDiscoveryResult
  /** Pages that yielded at least one image candidate. */
  acquisitionPageUrls: string[]
  /** Columns a high-confidence "not owned" critique verdict struck this run. */
  revokedColumns: string[]
  /** A search or render provider threw and no evidence was collected (Gate A). */
  providerFailure: boolean
}

// Lazy-import types only; both modules are loaded dynamically at runtime.
type AcquisitionPlanType = import('./acquisition/plan').AcquisitionPlanType
type AcquisitionUrlVerdicts = NonNullable<
  import('./acquisition/graph').AcquisitionOutput['urlVerdicts']
>

type StoredNameSource = {
  source: 'official_website' | 'official_social'
  url: string
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
  /**
   * True when the brand name yields zero Latin tokens of length >= 3. This is
   * broader than "Han-only": short Latin names such as KO and mixed names such
   * as 9O 玖零 qualify too. The flag arms a revoke, so the website proposal is
   * deleted rather than released. The cohort is approximately 113 brands.
   * Narrow or remove this shortcut when a real site-identity signal can confirm
   * or reject the host, so the decision no longer depends on the name's script.
   */
  unverifiable?: boolean
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
export function resolveOfficialWebsite(
  urls: string[],
  brandName?: string | null,
): { url: string | null; viaZeroTokenFallback: boolean } {
  const eligible = urls.filter(
    (u) =>
      classifyByDomain(u) === null &&
      !isNonBrandSiteHost(u) &&
      !isForeignCountryTld(u) &&
      !isInstitutionalHost(u),
  )
  const tokens = brandNameTokens(brandName)
  const matched = eligible.find((u) => hostMatchesBrandName(u, tokens))
  const fallback = tokens.length === 0 ? eligible.at(0) : undefined
  const url = normalizeToRootUrl(matched ?? fallback ?? null)
  return {
    url,
    viaZeroTokenFallback: matched === undefined && fallback !== undefined && url !== null,
  }
}

/**
 * The url alone, for callers that do not care how it was reached. Callers that
 * DO care must read `viaZeroTokenFallback` off `resolveOfficialWebsite` rather
 * than re-deriving the fallback condition from the brand name — one owner of
 * that fact, so a change to the fallback rule cannot silently disagree with a
 * copy of it at a call site.
 */
export function deriveOfficialWebsite(urls: string[], brandName?: string | null): string | null {
  return resolveOfficialWebsite(urls, brandName).url
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

function storedNameSources(brand: EnrichBrand): StoredNameSource[] {
  const sources: StoredNameSource[] = []
  const seen = new Set<string>()
  const add = (source: StoredNameSource['source'], value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') return
    const url = value.trim()
    const key = `${source}:${pageKey(url)}`
    if (seen.has(key)) return
    seen.add(key)
    sources.push({ source, url })
  }

  add('official_website', brand.purchase_website ?? brand.purchaseWebsite)
  add('official_social', brand.social_instagram)
  add('official_social', brand.social_threads)
  add('official_social', brand.social_facebook)
  return sources
}

/**
 * Produces candidates only from first-party URLs already stored on the brand.
 * Discovered SERP pages, marketplaces, and retailers may still enrich links,
 * but their titles can never enter name arbitration through this path.
 */
export function deriveOfficialNameCandidates(
  brand: EnrichBrand,
  scrapedData: EnrichScrapedData,
): NameCandidate[] {
  const perSource = Object.entries(scrapedData.perSourceText ?? {})
  const candidates: NameCandidate[] = []

  for (const stored of storedNameSources(brand)) {
    const match = perSource.find(([sourceUrl]) => sameUrl(sourceUrl, stored.url))
    let observedName = match?.[1].title?.trim()

    if (!observedName) {
      const provenanceUrl = scrapedData.textProvenance?.brandName?.sourceUrl
      const provenanceMatches = provenanceUrl && sameUrl(provenanceUrl, stored.url)
      if (provenanceMatches && typeof scrapedData.brandName === 'string') {
        observedName = scrapedData.brandName.trim()
      }
    }

    if (!observedName || !brand.name) continue
    const value = canonicalizeBilingualBrandName(brand.name, observedName)
    if (!value || value === brand.name.trim()) continue
    candidates.push({
      source: stored.source,
      value,
      evidence: [{ ...stored, observedName }],
    })
  }

  return candidates
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
 * store except the two below. The candidate list is truncated at
 * MAX_SECOND_PASS_URLS, so a store slotted before the website silently
 * pushes the brand's own site — the highest-quality evidence source — out of
 * the pass entirely on exactly the sparse-link brands this pass exists for.
 * A newly added store therefore lands in POST_WEBSITE_ONLINE_STORES by
 * default; only these two predate the website because they always have.
 * The budget is two-tier: MAX_SECOND_PASS_URLS base candidates plus up to
 * MAX_ZERO_TOKEN_SOCIAL_URLS extras for a zero-token brand. Their combined
 * total must stay within MAX_SCRAPE_URLS_PER_BRAND or scrapeBrandUrls truncates silently.
 */
const PRE_WEBSITE_ONLINE_STORE_KEYS: readonly string[] = ['pinkoi', 'shopee']

const PRE_WEBSITE_ONLINE_STORES = ONLINE_STORES.filter((channel) =>
  PRE_WEBSITE_ONLINE_STORE_KEYS.includes(channel.key),
)

const POST_WEBSITE_ONLINE_STORES = ONLINE_STORES.filter(
  (channel) =>
    channel.key !== 'website' && !PRE_WEBSITE_ONLINE_STORE_KEYS.includes(channel.key),
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
      ...PRE_WEBSITE_ONLINE_STORES.map((channel) => firstPassData[channel.camel]),
      firstPassData.purchaseWebsite,
      ...POST_WEBSITE_ONLINE_STORES.map((channel) => firstPassData[channel.camel]),
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
  unverifiableWebsite: boolean,
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
    const shouldMarkUnverifiable = subjectKind === 'website' && unverifiableWebsite
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
      if (shouldMarkUnverifiable) existing.unverifiable = true
      Object.assign(existing.evidence, evidence)
    } else {
      groups[subjectUrl] = {
        subjectUrl,
        subjectKind,
        columns: [column],
        evidence,
        ...(shouldMarkUnverifiable ? { unverifiable: true } : {}),
      }
    }
  }

  return groups
}

// `parsePhaseResults` drops any acquisitionPlan over 8 KB outright, so trim the
// runtime trace (least valuable tail first) rather than lose the whole record.
const MAX_AGENT_RECORD_BYTES = 7_800
function boundedAgentRecord(record: Record<string, unknown>): Record<string, unknown> {
  let current = record
  const size = (value: unknown): number => JSON.stringify(value).length
  while (size(current) > MAX_AGENT_RECORD_BYTES && Array.isArray(current.trace) && current.trace.length > 1) {
    current = { ...current, trace: current.trace.slice(0, -1) }
  }
  if (size(current) > MAX_AGENT_RECORD_BYTES && Array.isArray(current.surfaces)) {
    current = {
      ...current,
      surfaces: (current.surfaces as Array<Record<string, unknown>>).map((surface) => ({
        ...surface,
        reason: String(surface.reason ?? '').slice(0, 40),
      })),
    }
  }
  return current
}

/**
 * The persisted projection of the ranked pool: row id, tag, score, and the page
 * the image came from. Everything else in a `RankableImage` is either
 * re-derivable from the row or only useful to the run that produced it, and
 * `phase_results` is a JSON column shared with every other phase.
 */
function compactImagePool(pool: readonly RankableImage[]): NonNullable<PhaseResult['imagePool']> {
  const projected = pool.map((image) => ({
    id: image.id,
    tag: image.tag,
    score: image.score,
    ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
  }))
  return compactToBytes(projected, MAX_IMAGE_POOL_BYTES)
}

/**
 * Text this phase actually read. `brandName` stands in for the page title: it
 * is what the scraper writes a first-party `<title>` into, and `ScrapedBrandData`
 * has no separate title field.
 */
function hasScrapedText(data: EnrichScrapedData | undefined): boolean {
  if (!data) return false
  return [data.description, data.story, data.brandName].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
}

/**
 * Image candidates from a completed scrape — the fallback path's equivalent of
 * the agent's `images` node. Provenance first (`imageSources` carries the page
 * each image came from), plain URLs only when the scraper predates it.
 */
function candidatesFromScrapedData(scrapedData: EnrichScrapedData): CandidateImage[] {
  const sources = scrapedData.imageSources ?? []
  const scraped: Array<Omit<CandidateImage, 'source'>> =
    sources.length > 0
      ? sources.map((source) => ({
          url: source.url,
          method: source.method,
          pageUrl: source.pageUrl,
          position: source.position,
        }))
      : (scrapedData.galleryImageUrls ?? []).map((url) => ({ url }))

  return buildCandidatePool({
    scraped,
    jsonLdImages: scrapedData.jsonLdImageUrls ?? [],
    // Image search is the agent's recovery step, not part of a plain scrape.
    googleImages: [],
  })
}

/**
 * Attach the page each classified image came from, using the shared
 * `resolveSourceUrl` from image-ranking.ts. `sourceUrl` is populated by the
 * classify dep (which reads `source_url` from the DB row).
 */
function withSourceUrls(
  classified: readonly ClassifiedImage[],
): RankableImage[] {
  return classified.map((image) => ({
    ...image,
    sourceUrl: resolveSourceUrl(image),
  }))
}

/**
 * Turn the acquisition critique's per-URL ownership verdicts into revocations.
 *
 * This is the consumer `urlVerdicts` never had: the agent already judges every
 * page it fetched, so the quarantine no longer needs a second model to re-ask
 * the same question. Only `confidence: 'high'` + `owned: false` revokes
 * (`resolveQuarantine`); everything else — including a subject the critique
 * never mentioned — is released, which is the safe direction.
 *
 * Returns the columns actually struck, for `PhaseResult.revokedColumns`.
 */
function applyCritiqueRevocations(input: {
  brand: EnrichBrand
  quarantine: Record<string, QuarantineGroup>
  patch: Record<string, unknown>
  scrapedData: EnrichScrapedData
  images: RevokableImagePayload
  urlVerdicts: AcquisitionUrlVerdicts
}): string[] {
  const { brand, quarantine, patch, scrapedData, images, urlVerdicts } = input
  if (urlVerdicts.length === 0) return []

  const verdicts = verdictsFromCritique(urlVerdicts, brand.slug, quarantine)
  if (verdicts.size === 0) return []

  const revoked: string[] = []
  for (const group of Object.values(quarantine)) {
    const decision = resolveQuarantine(
      verdicts.get(siteIdentityKey(brand.slug, group.subjectUrl)),
    )
    if (!decision.revoked) continue
    // `patch` and `scrapedData` are the live objects, not copies: `revokeFields`
    // deletes patch keys and `revokeText` nulls description/story in place.
    const application = applyRevocation(
      brand,
      {
        ...group,
        patch: patch as EnrichPatch,
        scrapedData,
        linksResult: images,
      },
      decision.reason,
    )
    revoked.push(...application.phaseResult.changedFields)
  }

  return [...new Set(revoked)]
}

export async function runAcquirePhase({
  brand,
  phases,
  discoveredUrls,
  knownUrls,
  dryRun = false,
  target,
  jobId,
  supabase,
  renderProvider,
  deps = {},
  budgetScale,
  linkExpansion,
}: AcquirePhaseOptions): Promise<AcquirePhaseOutput> {
  // A phase gates on its OWN name only (the sibling rule in products.ts and
  // detect.ts). The retired `links` name is mapped to `acquire` by
  // `normalizeRequestedPhases` at every runner entry, never here.
  if (!phases.includes('acquire')) {
    return {
      phaseResult: buildPhaseResult('acquire', 'skipped', [], 0, undefined, 'acquire phase not requested'),
      patch: {},
      scrapedBrandName: null,
      officialNameCandidates: [],
      scrapedData: null,
      scrapedImageUrls: [],
      scrapedImageSources: [],
      jsonLdImageUrls: [],
      quarantine: {},
      imagePool: [],
      acquisitionPageUrls: [],
      revokedColumns: [],
      providerFailure: false,
    }
  }

  return auditedCall(
    { provider: 'enrich', operation: 'runAcquirePhase', kind: 'service' },
    async () => {
  const effectiveTarget = target ?? brandTarget(brand.id)
  const downloadImages = deps.downloadAndStoreImages ?? defaultDownloadAndStoreImages
  const classifyStored = deps.classifyStoredImages ?? defaultClassifyStoredImages
  const applyImageWrites = deps.applyPlannedImageWrites ?? defaultApplyPlannedImageWrites
  const finalizeHero = deps.finalizeHeroOrder ?? defaultFinalizeHeroOrder

  // One client for every row this phase writes, built only when there is a row
  // to write: a dry run and the unit tests never reach it.
  let client: unknown = supabase
  const db = (): unknown => {
    if (client === undefined || client === null) client = createServiceClient()
    return client
  }

  // Bind the brand key so per-brand budget tracking uses this brand's id, not
  // the shared `'unknown'` default (DEV-1644 F8). Returns a new provider so
  // there is no shared mutable state between brands.
  const renderForBrand = renderProvider ? bindBrandKey(renderProvider, brand.id) : undefined

  /**
   * Audit context for the agent's recovery searches, so each one writes a
   * `brand_search_results` row keyed to this target and job. The `search_type`
   * (`serp` for `searchBrandUrls`, `image` for `batchSearchBrandImages`) is
   * decided inside the serper client, which is the only place that knows which
   * endpoint it called.
   */
  const searchAudit = (): SerperAuditOptions => ({
    target: effectiveTarget,
    ...(jobId ? { jobId } : {}),
    ...(supabase ? { supabase } : {}),
    dryRun,
    config: { phase: 'acquire' },
  })

  const { result, durationMs } = await timePhase(async () => {
    const urls = prioritizeScrapeUrls(uniqueUrls([...knownUrls, ...discoveredUrls]))
    // These URLs are raw SERP results, so the brand name is the only thing
    // separating this brand's accounts from a same-ranking stranger's.
    const urlExtracted = extractLinksFromUrls(discoveredUrls, brand.name)
    const confirmedSourceUrls = new Set(knownUrls.map(scrapeKey))
    const scrapeOptions: ScrapeBrandUrlsOptions = {
      brandName: brand.name,
      confirmedSourceUrls,
      renderProvider: renderForBrand,
      onAttempt: async ({ url, classification, spanId }) => {
        const auditId = await startSearchAudit({
          target: effectiveTarget,
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
          config: { phase: 'acquire', dryRun },
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
    // -----------------------------------------------------------------------
    // Acquisition agent path: when enabled, delegates gather+plan+scrape to the
    // agent. On success, its scrapeResult replaces firstPass + scrapeDiscoveredLinks.
    // On failure or fallback outcome, falls through to the legacy path below.
    // -----------------------------------------------------------------------
    let agentAcquisitionPlan: AcquisitionPlanType | undefined
    let agentScrapeData: EnrichScrapedData | null = null
    let agentOutcome: string | undefined
    // Persisted alongside the plan so a fallback/blocked brand still carries a
    // decision timeline and its budget usage; without it the trace only exists
    // in process memory.
    let agentTrace: Record<string, unknown> | undefined
    /**
     * Row writes the classify seam produced. Applied IMMEDIATELY inside the
     * seam so recovery's `getUnclassifiedImages` does not re-read the same
     * `tags is null` rows. Image writes happen during the agent run, which is
     * acceptable because they are verdict writes on rows the agent itself
     * created.
     */
    const plannedWrites: PlannedImageWrite[] = []
    let appliedImageWrites = false
    let imagePool: RankableImage[] = []
    let catalogResult: CatalogDiscoveryResult | undefined
    let acquisitionPageUrls: string[] = []
    let urlVerdicts: AcquisitionUrlVerdicts = []
    let providerFailure = false

    if (process.env.ACQUISITION_AGENT !== 'off') {
      try {
        const runAcquisition =
          deps.runAcquisition ?? (await import('./acquisition/graph')).runAcquisition
        const { boundedPlan } = await import('./acquisition/plan')
        // Built by the shared runtime, which deliberately omits
        // `response_format: json_object`: the client refuses a forced JSON reply
        // alongside tool definitions, and the plan node offers four tools — with
        // it the model answers the plan step in raw JSON and never calls one.
        //
        // Audit attribution is fixed HERE, at construction: every turn the graph
        // runs on this model writes its `brand_ai_results` row against this
        // phase, target and job. `brand_ai_results.phase` for agent turns is the
        // phase that ran them, matching the `products` convention. The CHECK
        // accepts it (migration 20260903100400); `acquisition` stays a SUB_PHASE
        // for the historical rows written before this.
        const model = await (deps.createAgentModel ?? defaultCreateAgentModel)('acquisition', {
          phase: 'acquire',
          target: effectiveTarget,
          ...(jobId ? { jobId } : {}),
          ...(supabase ? { supabase } : {}),
        })
        const agentResult = await runAcquisition(
          {
            brand: { id: brand.id, slug: brand.slug, name: brand.name },
            knownUrls: [...knownUrls, ...discoveredUrls],
            jobId,
          },
          {
            fetchHtml: (await import('./scraper/fetch-guards')).fetchHtmlWithMetadata,
            renderProvider: renderForBrand,
            scrapeBrandUrls: (agentUrls, opts) =>
              scrapeBrandUrls(agentUrls, { ...scrapeOptions, ...opts }),
            // A dry run must not touch Storage, the vision model or the image
            // tables, so the two write-bearing seams are simply absent rather
            // than guarded inside the graph — there is then nothing to undo.
            ...(dryRun
              ? {}
              : {
                  downloadAndStoreImages: (candidates: CandidateImage[]) =>
                    downloadImages(candidates, effectiveTarget),
                  // Judges the rows just stored and returns the verdicts.
                  // Writes are applied IMMEDIATELY so recovery's
                  // `getUnclassifiedImages` does not re-read the same rows.
                  classifyImages: async () => {
                    const judged = await classifyStored({
                      brand,
                      target: effectiveTarget,
                      ...(jobId ? { jobId } : {}),
                      supabase: db(),
                    })
                    plannedWrites.push(...judged.writes)
                    if (plannedWrites.length > 0) {
                      // Snapshot before clearing: the caller may hold a ref.
                      const batch = [...plannedWrites]
                      plannedWrites.length = 0
                      await applyImageWrites(db(), effectiveTarget, batch)
                      appliedImageWrites = true
                    }
                    return judged.classified
                  },
                }),
            discoverCatalog: deps.discoverCatalog ?? defaultDiscoverCatalog,
            catalogSources: buildChannelSources(brand),
            searchBrand: async (query: string) => ({
              urls: await (deps.searchBrandUrls ?? defaultSearchBrandUrls)(
                query,
                undefined,
                searchAudit(),
              ),
              snippets: [],
            }),
            searchImages: async ({
              brandName,
              websiteHost,
            }: {
              brandName: string
              websiteHost: string | null
            }) => {
              // `batchSearchBrandImages` expands an object input through
              // `buildImageQueryVariants` itself, so the `site:` branch is
              // reached by handing it the domain rather than a pre-built query.
              const input: ImageQueryInput = {
                brandName,
                categorySlug: brand.category,
                purchaseWebsite: websiteHost ? `https://${websiteHost}` : null,
              }
              const outcomes = await (
                deps.batchSearchBrandImages ?? defaultBatchSearchBrandImages
              )([input], 1, undefined, () => searchAudit())
              return outcomes.get(brandName)?.rows.map((row) => row.url) ?? []
            },
          },
          {
            model,
            dryRun,
            ...(budgetScale !== undefined ? { budgetScale } : {}),
          },
        )

        agentOutcome = agentResult.agentOutcome
        agentTrace = {
          trace: agentResult.decisions.slice(0, 24).map((d) => ({
            ...d,
            action: d.action.slice(0, 60),
            reason: d.reason.slice(0, 160),
          })),
          ...(agentResult.budget ? { budget: agentResult.budget } : {}),
          ...(agentResult.error ? { error: agentResult.error.slice(0, 200) } : {}),
        }
        // Read on every outcome, not only the successful ones: Gate A exists
        // precisely for the run where the provider died and the agent gave up.
        providerFailure = agentResult.providerFailure === true
        urlVerdicts = agentResult.urlVerdicts ?? []
        imagePool = agentResult.imagePool ?? []
        catalogResult = agentResult.catalogResult
        acquisitionPageUrls = agentResult.acquisitionPageUrls ?? []
        if (
          (agentResult.agentOutcome === 'planned' || agentResult.agentOutcome === 'recovered') &&
          agentResult.scrapeResult
        ) {
          agentAcquisitionPlan = agentResult.plan ? boundedPlan(agentResult.plan) : undefined
          agentScrapeData = agentResult.scrapeResult.data as EnrichScrapedData
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('  → acquisition agent failed, falling back to legacy path:', message)
        agentOutcome = 'fallback'
        agentTrace = { trace: [], error: `threw: ${message.slice(0, 180)}` }
      }
    }

    let scrapedFromPages: EnrichScrapedData
    if (agentScrapeData) {
      // Agent provided the scrape data — skip the legacy firstPass + second pass.
      scrapedFromPages = agentScrapeData
    } else {
      // Legacy path: direct scrape + discovered links follow-up.
      const firstPass = urls.length > 0 ? await scrapeBrandUrls(urls, scrapeOptions) : null
      scrapedFromPages = firstPass
        ? await scrapeDiscoveredLinks(firstPass.data, urls, scrapeOptions, urlExtracted)
        : ({} as EnrichScrapedData)
    }

    const { url: resolvedWebsite, viaZeroTokenFallback } = resolveOfficialWebsite(urls, brand.name)
    const derivedWebsite = scrapedFromPages.purchaseWebsite ?? resolvedWebsite
    const hasBrandName = typeof brand.name === 'string' && brand.name.trim().length > 0
    const unverifiableWebsite = hasBrandName && viaZeroTokenFallback
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
    const officialNameCandidates = deriveOfficialNameCandidates(brand, scrapedData)

    // Fallback catalog discovery: when the agent returned no catalog, run
    // discoverCatalog over the brand's channel sources + entry URLs so a
    // fallback brand still gets product triples for the products phase.
    if (!agentScrapeData && !catalogResult && urls.length > 0) {
      try {
        const discover = deps.discoverCatalog ?? defaultDiscoverCatalog
        catalogResult = await discover({
          sources: buildChannelSources(brand),
          entryUrls: urls,
          priorityProductUrls: [],
          renderProvider: renderForBrand,
        })
      } catch {
        // Errors silently swallowed — catalogResult stays undefined.
      }
    }

    // Fallback path images. `images` and `classify_images` are deferred phases,
    // so a brand whose agent fell back would otherwise finish a full run with
    // no image at all. Same download → judge → write sequence the agent uses,
    // run over the candidates the legacy scrape produced.
    if (!dryRun && !agentScrapeData && plannedWrites.length === 0 && imagePool.length === 0) {
      const candidates = candidatesFromScrapedData(scrapedData)
      if (candidates.length > 0) {
        const supabaseClient = db()
        await downloadImages(candidates, effectiveTarget)
        const judged = await classifyStored({
          brand,
          target: effectiveTarget,
          ...(jobId ? { jobId } : {}),
          supabase: supabaseClient,
        })
        plannedWrites.push(...judged.writes)
        imagePool = rank(
          withSourceUrls(judged.classified),
          HERO_TARGET_RATIO,
        ) as RankableImage[]
        acquisitionPageUrls = [
          ...new Set(
            candidates
              .map((candidate) => candidate.pageUrl)
              .filter((url): url is string => typeof url === 'string' && url.length > 0),
          ),
        ]
      }
    }

    const quarantine = buildQuarantine(scrapedData, fieldSources, patch, unverifiableWebsite)
    // The arrays a revocation strikes from. Held apart from `scrapedData` so
    // `filterRevokedImages` mutates exactly what this phase returns.
    const images: RevokableImagePayload = {
      scrapedImageUrls: scrapedData.galleryImageUrls ?? [],
      scrapedImageSources: scrapedData.imageSources ?? [],
      jsonLdImageUrls: scrapedData.jsonLdImageUrls ?? [],
      scrapedData,
    }
    const revokedColumns = applyCritiqueRevocations({
      brand,
      quarantine,
      patch,
      scrapedData,
      images,
      urlVerdicts,
    })

    // Apply any remaining writes (fallback path accumulates here; the agent
    // path applies inside the classifyImages seam and clears the array).
    if (!dryRun && plannedWrites.length > 0) {
      await applyImageWrites(db(), effectiveTarget, plannedWrites)
      appliedImageWrites = true
    }
    // Hero order is recomputed from written rows — runs after ALL writes.
    if (!dryRun && appliedImageWrites) {
      const hero = await finalizeHero(db(), effectiveTarget, { mode: 'classify' })
      // A brand target denormalizes its hero inside `finalizeHeroOrder`; a
      // submission carries the bucket key forward on its patch instead.
      if (effectiveTarget.type === 'submission' && hero.heroStoragePath) {
        patch.hero_image_storage_path = hero.heroStoragePath
      }
    }

    return {
      patch,
      scrapedBrandName,
      officialNameCandidates,
      scrapedData,
      scrapedImageUrls: images.scrapedImageUrls,
      scrapedImageSources: images.scrapedImageSources,
      jsonLdImageUrls: images.jsonLdImageUrls,
      quarantine,
      revokedColumns,
      imagePool,
      catalogResult,
      acquisitionPageUrls,
      providerFailure,
      agentAcquisitionPlan,
      agentOutcome,
      agentTrace,
    }
  })

  // What this phase PRODUCES is evidence; the patch is only the part of that
  // evidence which happens to be a brand column. A refresh whose link columns
  // are already correct leaves an empty patch, and reading that as `skipped`
  // reported 6/10 brands as skipped on the first staging run while the agent had
  // planned, scraped text, classified images and discovered a catalog.
  const catalogTriples = result.catalogResult?.triples.length ?? 0
  const acquiredEvidence =
    (result.agentOutcome === 'planned' || result.agentOutcome === 'recovered' || result.agentOutcome === 'fallback') &&
    (result.imagePool.length > 0 ||
      catalogTriples > 0 ||
      hasScrapedText(result.scrapedData))
  const status = hasPatchValues(result.patch) || acquiredEvidence ? 'succeeded' : 'skipped'
  // `images` and `catalog` are runlog LABELS, not patch keys: nothing reads a
  // `changedFields` entry as a column to write (`curation-operations` only
  // aggregates them for the progress event and the outcome log).
  const adoptedColumns = linkExpansion?.adopted?.map((a) => a.field) ?? []
  const changedFields = [
    ...Object.keys(result.patch),
    ...adoptedColumns,
    ...(result.imagePool.length > 0 ? ['images'] : []),
    ...(catalogTriples > 0 ? ['catalog'] : []),
  ]

  return {
    phaseResult: {
      ...buildPhaseResult('acquire', status, changedFields, durationMs),
      ...(result.agentOutcome
        ? { agentOutcome: result.agentOutcome as PhaseResult['agentOutcome'] }
        : {}),
      ...(result.agentOutcome
        ? {
            acquisitionPlan: boundedAgentRecord({
              ...(result.agentAcquisitionPlan as unknown as Record<string, unknown> | undefined),
              ...result.agentTrace,
            }),
          }
        : {}),
      ...(result.providerFailure ? { providerFailure: true } : {}),
      ...(result.revokedColumns.length > 0 ? { revokedColumns: result.revokedColumns } : {}),
      ...(result.imagePool.length > 0 ? { imagePool: compactImagePool(result.imagePool) } : {}),
      ...(linkExpansion ? { linkExpansion } : {}),
    },
    patch: result.patch,
    scrapedBrandName: result.scrapedBrandName,
    officialNameCandidates: result.officialNameCandidates,
    scrapedData: result.scrapedData,
    scrapedImageUrls: result.scrapedImageUrls,
    scrapedImageSources: result.scrapedImageSources,
    jsonLdImageUrls: result.jsonLdImageUrls,
    // Built inside the phase body, because the revocation reads it: a second
    // build here would judge a patch the first one had already struck from.
    quarantine: result.quarantine,
    imagePool: result.imagePool,
    ...(result.catalogResult ? { catalogResult: result.catalogResult } : {}),
    acquisitionPageUrls: result.acquisitionPageUrls,
    revokedColumns: result.revokedColumns,
    providerFailure: result.providerFailure,
    ...(result.agentAcquisitionPlan ? { acquisitionPlan: result.agentAcquisitionPlan } : {}),
  }
    },
    {
      classify: (result) =>
        result.phaseResult.status === 'skipped' ? 'empty' : 'succeeded',
    },
  )
}
