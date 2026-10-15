/**
 * Per-brand link expansion gather, extracted from `runEnrich`'s `gather` block
 * (DEV-2032 CODE-11).
 *
 * Three deterministic sources — hub pages, Threads bio, and a single SERP
 * query — are consulted for EVERY brand. The SERP includes the IG handle in
 * the query when available. Every step records its own outcome so the verdict
 * finalizer knows what was consulted.
 *
 * Mutates `brand` in place (adopted link columns) and adds a successful live
 * search to `searchResults`; the caller stores the returned entry.
 */

import type { BrandFlatLinkColumns } from '@/lib/types'
import type { PhaseResult, SourceOutcome } from '@/lib/types/curation'
import type { EnrichmentTarget } from '../../_shared/enrichment-target'
import { getDisplayBrandName, type SearchPhaseResult } from '../../enrich-phases'
import {
  collectHubUrls,
  deriveThreadsUrl,
  expandLinkHubs,
  expandSerpDiscoveredHubs,
  expandThreadsBio,
  hasPurchaseChannel,
  type AdoptedLink,
  type ChannelSources,
  type LinkExpansionBrand,
} from '../../enrich-phases/link-expansion'
import {
  fetchHtml,
  fetchHtmlWithMetadata,
} from '../../enrich-phases/scraper/fetch-guards'
import { extractInstagramHandle } from '../../enrich-phases/scraper/parse/extractors'
import { isUsableHandle } from '../../enrich-phases/scraper/search'
import { batchSearchBrandsWithSnippets } from '../../enrich-phases/scraper/serper'
import {
  buildLinkEnrichPatch,
  extractLinksFromUrls,
  hasLinkValue,
} from '../../link-enrichment'
import { isFreshSearchResult, type SearchResultRow } from '../../search-results'

/** Replayed search rows stay usable for three days. */
const SEARCH_REPLAY_MAX_AGE_MS = 3 * 86_400_000

/**
 * One brand's slot in a `batchSearchBrandsWithSnippets` map. Derived from the
 * function rather than restated: the result shape is not exported, and a local
 * copy of it could disagree with the provider adapter without anyone noticing.
 */
type SerpResult = ReturnType<
  Awaited<ReturnType<typeof batchSearchBrandsWithSnippets>>['get']
>

/**
 * Gather's SERP name query. The IG handle is included when usable so a single
 * credit covers both name and handle discovery. Exported so the detect golden
 * regenerate script re-searches with the exact production query (DEV-1894).
 */
export function serpNameQuery(name: string, handle: string | null): string {
  return handle && isUsableHandle(handle)
    ? `${name} ${handle} 台灣`
    : `${name} 台灣`
}

export type GatherExpansionEntry = {
  patch: Partial<BrandFlatLinkColumns>
  serp: 'replayed' | 'searched' | 'none'
  sources: ChannelSources
  /** Statuses of the search calls actually made, replay included. */
  serpCallStatuses: Array<string | null | undefined>
  linkExpansion: NonNullable<PhaseResult['linkExpansion']>
}

export type GatherBrand = {
  id: string
  slug: string
  name?: string | null
} & LinkExpansionBrand &
  Partial<BrandFlatLinkColumns>

export type GatherBrandInput = {
  /** Fresh rows are replayed instead of searching live. */
  rawSearchResultsById: ReadonlyMap<string, SearchResultRow>
  /** Receives this run's answered live search, keyed by display name. */
  searchResults: Map<string, SearchPhaseResult>
  targetType: EnrichmentTarget['type']
  jobId: string | undefined
  onProgress: (line: string) => void
  errorMessage: (error: unknown) => string
}

export async function gatherBrandLinkExpansion(
  brand: GatherBrand,
  input: GatherBrandInput,
): Promise<GatherExpansionEntry> {
  const {
    rawSearchResultsById,
    searchResults,
    targetType,
    jobId,
    onProgress,
    errorMessage,
  } = input
  const brandName = getDisplayBrandName(brand)
  const hubUrls = collectHubUrls(brand)

  // Build confirmed URL set from submitted website_url and other_urls
  const confirmedHubUrls = new Set<string>()
  if (brand.website_url) confirmedHubUrls.add(brand.website_url)
  if (Array.isArray(brand.other_urls)) {
    for (const entry of brand.other_urls as Array<{
      url?: string
    }>) {
      if (entry?.url && typeof entry.url === 'string') {
        confirmedHubUrls.add(entry.url)
      }
    }
  }

  const expansion = await expandLinkHubs({
    brandName,
    hubUrls,
    confirmedHubUrls,
    fetchHtml,
  })

  // Build patch from hub-scraped links and adopt onto the brand object
  let patch = buildLinkEnrichPatch(
    brand as BrandFlatLinkColumns,
    expansion.scraped,
    brandName,
  )
  Object.assign(brand, patch)

  const adoptedLinks: AdoptedLink[] = [...expansion.adopted]
  const gatedTags = [...(expansion.gated ?? [])]
  let hubsFetched = expansion.hubsFetched
  const serpCallStatuses: Array<string | null | undefined> = []
  const sources: ChannelSources = {
    hubs:
      hubUrls.length === 0
        ? 'skipped'
        : expansion.adopted.length > 0
          ? 'found'
          : (expansion.fetchFailures ?? 0) > 0
            ? 'unknown'
            : 'absent',
    threads: 'skipped',
    serpName: 'skipped',
  }
  let serp: 'replayed' | 'searched' | 'none' = 'none'

  /**
   * Merge an adoption into the patch that is actually PERSISTED.
   * Assigning onto `brand` alone only survives inside this run: the
   * refresh submission is written from `patch`, so a SERP-found shop
   * that never reached it was silently dropped (DEV-1702 proof run).
   * An earlier source owns its column — nothing here displaces a value
   * already in the patch.
   */
  const mergeIntoPatch = (extracted: Partial<BrandFlatLinkColumns>) => {
    const next: Record<string, unknown> = { ...patch }
    for (const [column, value] of Object.entries(extracted)) {
      if (typeof value !== 'string') continue
      if (hasLinkValue(next[column] as string | null)) continue
      next[column] = value
    }
    patch = next as Partial<BrandFlatLinkColumns>
  }

  /** Adopt SERP URLs onto the brand and say what that answered. */
  const applySerpUrls = (urls: string[]): SourceOutcome => {
    const extracted = extractLinksFromUrls(urls, brandName)
    if (Object.keys(extracted).length === 0) return 'absent'
    Object.assign(brand, extracted)
    mergeIntoPatch(extracted)
    const channelFound = hasPurchaseChannel(brand)
    return channelFound ? 'found' : 'absent'
  }

  // ---- Threads bio: one fetch of the brand's own profile ----
  const threadsUrl =
    brand.social_threads ?? deriveThreadsUrl(brand.social_instagram)
  if (threadsUrl) {
    const bio = await expandThreadsBio({
      brandName,
      threadsUrl,
      confirmedHubUrls,
      fetchHtmlWithMetadata,
      fetchHtml,
    })
    sources.threads = bio.threads
    adoptedLinks.push(...bio.adopted)
    if (bio.gated?.length) gatedTags.push(...bio.gated)
    if (bio.adopted.length > 0) {
      const threadsPatch = buildLinkEnrichPatch(
        brand as BrandFlatLinkColumns,
        bio.scraped,
        brandName,
      )
      Object.assign(brand, threadsPatch)
      patch = { ...patch, ...threadsPatch }
    }
  }

  // ---- SERP: replay a fresh cached row, or search live ----
  // The query includes the IG handle when available so a single
  // credit covers both name and handle discovery.
  const handle = extractInstagramHandle(brand.social_instagram)
  let serpUrls: string[] = []
  const cachedRow = rawSearchResultsById.get(brand.id)
  if (cachedRow && isFreshSearchResult(cachedRow, SEARCH_REPLAY_MAX_AGE_MS)) {
    serp = 'replayed'
    serpCallStatuses.push(cachedRow.callStatus)
    serpUrls = cachedRow.urls
    sources.serpName = applySerpUrls(serpUrls)
  } else {
    serp = 'searched'
    const queryTemplate = (name: string) => serpNameQuery(name, handle)
    let nameResult: SerpResult = undefined
    try {
      const results = await batchSearchBrandsWithSnippets(
        [brandName],
        queryTemplate,
        1,
        () => ({
          target: { type: targetType, id: brand.id },
          jobId,
          config: { phase: 'acquire' as const },
        }),
      )
      nameResult = results.get(brandName)
    } catch (error) {
      onProgress(`  [SERP-FAIL] ${brand.slug}: ${errorMessage(error)}`)
    }
    serpCallStatuses.push(nameResult?.callStatus)
    serpUrls = nameResult?.urls ?? []
    const nameStatus = nameResult?.callStatus
    const nameAnswered =
      nameResult && (nameStatus === 'succeeded' || nameStatus === 'empty')
    sources.serpName = nameAnswered ? applySerpUrls(serpUrls) : 'unknown'
    // Detect and the per-brand phases read `searchResults`, which
    // was loaded from the cache before this search ran. Without
    // this, a first run judged the brand with no SERP evidence
    // (DEV-1893). A failed search keeps any stale cached row.
    if (nameResult && nameAnswered) {
      searchResults.set(brandName, nameResult)
    }
  }

  // ---- SERP-discovered hub expansion ----
  const serpHubs = await expandSerpDiscoveredHubs({
    serpUrls,
    handle,
    brandName,
    confirmedHubUrls,
    fetchHtml,
  })
  adoptedLinks.push(...serpHubs.adopted)
  hubsFetched += serpHubs.hubsFetched
  if (serpHubs.gated?.length) gatedTags.push(...serpHubs.gated)
  if (
    serpHubs.fetchFailures > 0 &&
    serpHubs.adopted.length === 0 &&
    sources.serpName === 'absent'
  ) {
    sources.serpName = 'unknown'
  }
  if (serpHubs.adopted.length > 0) {
    const hubPatch = buildLinkEnrichPatch(
      brand as BrandFlatLinkColumns,
      serpHubs.scraped,
      brandName,
    )
    Object.assign(brand, hubPatch)
    patch = { ...patch, ...hubPatch }
  }

  const adopted = adoptedLinks.map((link) => ({
    field: link.field,
    url: link.value,
    source: link.source,
  }))

  return {
    patch,
    serp,
    sources,
    serpCallStatuses,
    linkExpansion: {
      hubsFetched,
      adopted,
      serp,
      sources,
      ...(gatedTags.length ? { gated: gatedTags.join(', ') } : {}),
    },
  }
}
