import { normalizeToRootUrl } from '@/lib/url'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLinkEnrichPatch, extractLinksFromUrls } from '../link-enrichment'
import { cleanBrandName, isValidBrandName } from '../brand-cleanup'
import { finishSearchAudit, startSearchAudit } from '../search-results'
import { scrapeBrandUrls } from './scraper'
import { classifyByDomain } from './scraper/input-detector'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { brandTarget, type EnrichmentTarget } from '../enrichment-target'
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
  scrapedData: EnrichScrapedData | null
  scrapedImageUrls: string[]
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
  const firstOfficial = official.at(0)
  return [...(firstOfficial ? [firstOfficial] : []), ...social, ...marketplace, ...official.slice(1)]
}

function deriveOfficialWebsite(urls: string[]): string | null {
  const url = urls.find((u) => classifyByDomain(u) === null)
  return normalizeToRootUrl(url ?? null)
}

function normalizeScrapedData(scrapedData: EnrichScrapedData): EnrichScrapedData {
  return {
    ...scrapedData,
    social_instagram: scrapedData.social_instagram ?? scrapedData.socialInstagram,
    social_threads: scrapedData.social_threads ?? scrapedData.socialThreads,
    social_facebook: scrapedData.social_facebook ?? scrapedData.socialFacebook,
    purchase_website: scrapedData.purchase_website ?? scrapedData.purchaseWebsite,
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
 * never consumed, so `adela.tw` handed us `adela愛德拉 ｜守護家人，為愛研發` on
 * every run and we discarded it while the record stayed `ADELA`.
 *
 * Only an addition is accepted: the cleaned title must still contain the name
 * we already hold, so `ADELA` can grow into `Adela 愛德拉` but a page title
 * naming a different company cannot rebrand the record. `isValidBrandName`
 * adds the length and SEO-copy guards the detect phase already relies on.
 *
 * Note this lands after the batch image-search phase, so the improved name
 * reaches the DB now and the *next* run's search queries — not this one's.
 */
export function deriveScrapedBrandName(
  brand: Pick<EnrichBrand, 'name'>,
  scrapedData: Pick<EnrichScrapedData, 'brandName'>
): string | null {
  const current = brand.name?.trim()
  const raw = scrapedData.brandName?.trim()
  if (!current || !raw) return null

  const cleaned = cleanBrandName(raw).cleanedName.trim()
  if (!cleaned || cleaned === current) return null
  if (!isValidBrandName(cleaned, current)) return null
  // Additive only: the scraped name must still carry the existing one.
  if (!cleaned.toLowerCase().includes(current.toLowerCase())) return null
  if (cleaned.length <= current.length) return null

  return cleaned
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
      scrapedData: null,
      scrapedImageUrls: [],
      jsonLdImageUrls: [],
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const urls = prioritizeScrapeUrls(uniqueUrls([...knownUrls, ...discoveredUrls]))
    const urlExtracted = extractLinksFromUrls(discoveredUrls)
    const { data: scraped } =
      urls.length > 0
        ? await scrapeBrandUrls(urls, {
            onAttempt: async ({ url, classification }) => {
              const auditId = await startSearchAudit({
                target: target ?? brandTarget(brand.id),
                ...(jobId ? { jobId } : {}),
                supabase,
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
                    },
                    supabase,
                  )
                },
              }
            },
          })
        : { data: {} as EnrichScrapedData }
    const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls)
    const scrapedData = normalizeScrapedData({
      ...scraped,
      ...urlExtracted,
      purchaseWebsite: derivedWebsite,
    })
    const linkPatch = buildLinkEnrichPatch(brand, scrapedData)
    const scrapedName = deriveScrapedBrandName(brand, scrapedData)
    // buildLinkEnrichPatch is typed to link columns only; widen at this
    // boundary rather than loosening that type to admit a name.
    const patch: Record<string, unknown> = scrapedName
      ? { ...linkPatch, name: scrapedName }
      : linkPatch
    return {
      patch,
      scrapedData,
      scrapedImageUrls: scrapedData.galleryImageUrls ?? [],
      jsonLdImageUrls: scrapedData.jsonLdImageUrls ?? [],
    }
  })

  const changedFields = Object.keys(result.patch)
  const status = hasPatchValues(result.patch) ? 'succeeded' : 'skipped'

  return {
    phaseResult: buildPhaseResult('links', status, changedFields, durationMs),
    patch: result.patch,
    scrapedData: result.scrapedData,
    scrapedImageUrls: result.scrapedImageUrls,
    jsonLdImageUrls: result.jsonLdImageUrls,
  }
}
