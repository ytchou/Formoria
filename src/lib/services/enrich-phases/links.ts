import { normalizeToRootUrl } from '@/lib/url'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildLinkEnrichPatch, extractLinksFromUrls } from '../link-enrichment'
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
    const patch = buildLinkEnrichPatch(brand, scrapedData)
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
