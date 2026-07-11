import {
  buildLinkEnrichPatch,
  extractLinksFromUrls,
} from '../link-enrichment'
import { insertSearchResult } from '../search-results'
import { scrapeBrandUrls } from './scraper'
import { classifyByDomain } from './scraper/input-detector'
import type { PhaseResult } from '@/lib/types/curation'
import type { EnrichScrapedData } from './types'
import { buildPhaseResult, hasPatchValues, timePhase, type EnrichBrand, type EnrichPhase } from './types'

type LinksPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  discoveredUrls: string[]
  knownUrls: string[]
  dryRun?: boolean
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

function deriveOfficialWebsite(urls: string[]): string | null {
  return urls.find((url) => classifyByDomain(url) === null) ?? null
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

function buildScrapePayload(scrapedData: EnrichScrapedData): Record<string, unknown> | null {
  if (!scrapedData.description && !scrapedData.story && !scrapedData.rawJsonLd && !scrapedData.stockistPageText) {
    return null
  }

  return {
    pageUrl: scrapedData.websiteUrl ?? scrapedData.purchaseWebsite ?? scrapedData.purchase_website ?? null,
    description: scrapedData.description ?? null,
    story: scrapedData.story ?? null,
    jsonLd: scrapedData.rawJsonLd ?? null,
    stockistPageText: scrapedData.stockistPageText ?? null,
  }
}

export async function runLinksPhase({
  brand,
  phases,
  discoveredUrls,
  knownUrls,
  dryRun = false,
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
    const urls = uniqueUrls([...knownUrls, ...discoveredUrls])
    const urlExtracted = extractLinksFromUrls(discoveredUrls)
    const { data: scraped } = urls.length > 0
      ? await scrapeBrandUrls(urls)
      : { data: {} as EnrichScrapedData }
    const derivedWebsite = scraped.purchaseWebsite ?? deriveOfficialWebsite(urls)
    const scrapedData = normalizeScrapedData({
      ...scraped,
      ...urlExtracted,
      purchaseWebsite: derivedWebsite,
    })
    const patch = buildLinkEnrichPatch(brand, scrapedData)
    const scrapePayload = buildScrapePayload(scrapedData)

    if (!dryRun && scrapePayload) {
      const pageUrl = typeof scrapePayload.pageUrl === 'string'
        ? scrapePayload.pageUrl
        : derivedWebsite ?? urls[0] ?? ''
      await insertSearchResult(
        brand.id,
        'scrape',
        pageUrl,
        pageUrl ? [pageUrl] : [],
        [scrapedData.description, scrapedData.story].filter((text): text is string => Boolean(text)),
        scrapePayload
      )
    }

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
