/**
 * Chunk-scope SERP cache load, extracted from `runEnrich` (DEV-2032 CODE-11).
 *
 * An enrichment run needs SERP context for detect and LLM phases, so replay
 * the stored results. Replayed rows are marked `fromCache` so a historical
 * provider failure is never mistaken for a live one.
 */

import { ENRICH_LLM_PHASES } from '@/lib/constants/enrich-phases'
import type { EnrichmentTarget } from '../../_shared/enrichment-target'
import {
  getDisplayBrandName,
  loadCachedSearchResults,
  type SearchPhaseResult,
} from '../../enrich-phases'
import { getLatestSearchResults, type SearchResultRow } from '../../search-results'

export type SerpCacheInput = {
  chunk: ReadonlyArray<{ id: string; name?: string | null }>
  phases: readonly string[]
  targetType: EnrichmentTarget['type']
  onProgress: (line: string) => void
}

export type SerpCache = {
  /**
   * Keyed by display brand name. The gather block adds this run's live search
   * results to the same map, so callers keep the returned instance.
   */
  searchResults: Map<string, SearchPhaseResult>
  /**
   * Raw SERP rows keyed by brand ID — used by the gather block to check
   * freshness before deciding whether to re-search.
   */
  rawSearchResultsById: Map<string, SearchResultRow>
}

export async function loadChunkSerpCache(
  input: SerpCacheInput,
): Promise<SerpCache> {
  const { chunk, phases, targetType, onProgress } = input
  const requestedPhases = new Set<string>(phases)
  const needsCachedSerp = ENRICH_LLM_PHASES.some((phase) =>
    requestedPhases.has(phase),
  )

  let searchResults = new Map<string, SearchPhaseResult>()
  let rawSearchResultsById = new Map<string, SearchResultRow>()
  if (needsCachedSerp) {
    rawSearchResultsById = await getLatestSearchResults(
      chunk.map((brand) => brand.id),
      'serp',
      targetType,
      'name',
    )
    const cached = await loadCachedSearchResults(
      chunk.map((brand) => brand.id),
      targetType,
    )
    const cachedByName = new Map<string, SearchPhaseResult>()
    for (const brand of chunk) {
      const row = cached.get(brand.id)
      if (row) {
        cachedByName.set(getDisplayBrandName(brand), row)
      }
    }
    searchResults = cachedByName
    const cachedCount = [...searchResults.values()].filter(
      (r) => r.snippets.length > 0,
    ).length
    if (cachedCount > 0) {
      onProgress(`  [SERP-CACHE] Loaded ${cachedCount} cached snippet sets`)
    }
  }

  return { searchResults, rawSearchResultsById }
}
