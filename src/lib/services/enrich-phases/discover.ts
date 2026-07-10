import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandsWithSnippets } from './scraper/search'
import { getLatestSearchResults, insertSearchResult } from '../search-results'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildSerpConfig } from '@/lib/constants/enrichment-config'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type SearchPhaseResult,
} from './types'

function buildSerpQuery(brandName: string, productTypeSlug?: string | null): string {
  const typeZh = productTypeSlug
    ? PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === productTypeSlug)?.nameZh
    : undefined
  const typeSegment = typeZh ? ` ${typeZh}` : ''
  return `"${brandName}"${typeSegment} 品牌 介紹 評價 推薦 -徵才 -104 -人力 -site:formoria.com`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export async function runDiscoverPhase(ctx: BatchPhaseContext): Promise<{
  phaseResult: PhaseResult
  searchResults: Map<string, SearchPhaseResult>
  searchError: string | null
}> {
  if (!ctx.phases.includes('discover')) {
    return {
      phaseResult: buildPhaseResult('discover', 'skipped', [], 0, undefined, 'discover not requested'),
      searchResults: new Map(),
      searchError: null,
    }
  }

  if (ctx.chunk.length === 0) {
    return {
      phaseResult: buildPhaseResult('discover', 'skipped', [], 0, undefined, 'empty batch'),
      searchResults: new Map(),
      searchError: null,
    }
  }

  const brandProductTypes = new Map(
    ctx.chunk.map((b) => [getDisplayBrandName(b), b.product_type])
  )
  const queryTemplate = (name: string) => buildSerpQuery(name, brandProductTypes.get(name))

  const { result, durationMs } = await timePhase(async () => {
    try {
      const searchResults = await batchSearchBrandsWithSnippets(ctx.chunkBrandNames, queryTemplate)
      const serpHits = [...searchResults.values()].filter(
        (searchResult) => searchResult.snippets.length > 0 || searchResult.urls.length > 0
      ).length
      const serpMisses = searchResults.size - serpHits
      ctx.onProgress?.(
        `  [SERP] OK — ${serpHits}/${searchResults.size} brands with results${serpMisses > 0 ? ` (${serpMisses} empty)` : ''}`
      )

      const changedFields: string[] = []
      if (!ctx.dryRun) {
        const serpBrandIds: string[] = []
        for (const brand of ctx.chunk) {
          const brandName = getDisplayBrandName(brand)
          const searchResult = searchResults.get(brandName)
          if (searchResult && (searchResult.urls.length > 0 || searchResult.snippets.length > 0)) {
            await insertSearchResult(
              brand.id,
              'serp',
              queryTemplate(brandName),
              searchResult.urls,
              searchResult.snippets,
              searchResult.rawEntries,
              buildSerpConfig(),
              searchResult.latencyMs
            )
            serpBrandIds.push(brand.id)
          }
        }

        if (serpBrandIds.length > 0) {
          changedFields.push('serp_search_results')
        }
      }

      return { searchResults, searchError: null, changedFields }
    } catch (err) {
      const searchError = errorMessage(err)
      ctx.onProgress?.(`  [SERP] FAILED — ${searchError}`)
      return {
        searchResults: new Map<string, SearchPhaseResult>(),
        searchError,
        changedFields: [],
      }
    }
  })

  return {
    phaseResult: buildPhaseResult(
      'discover',
      result.searchError ? 'failed' : 'succeeded',
      result.changedFields,
      durationMs,
      result.searchError ?? undefined
    ),
    searchResults: result.searchResults,
    searchError: result.searchError,
  }
}

export async function loadCachedSearchResults(
  brandIds: string[]
): Promise<Map<string, SearchPhaseResult>> {
  const cached = await getLatestSearchResults(brandIds, 'serp')
  const searchResults = new Map<string, SearchPhaseResult>()

  for (const [brandId, row] of cached) {
    searchResults.set(brandId, {
      urls: row.urls,
      snippets: row.snippets,
    })
  }

  return searchResults
}
