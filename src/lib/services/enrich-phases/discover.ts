import type { PhaseResult } from '@/lib/types/curation'
import { batchSearchBrandsWithSnippets, parseBrandSearchEntries } from './scraper/search'
import { getLatestSearchResults } from '../search-results'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildSerpConfig } from '@/lib/constants/enrichment-config'
import type { EnrichmentTarget } from '../enrichment-target'
import {
  buildPhaseResult,
  getDisplayBrandName,
  timePhase,
  type BatchPhaseContext,
  type SearchPhaseResult,
} from './types'

export function buildSerpQuery(brandName: string, productTypeSlug?: string | null): string {
  const typeZh = productTypeSlug
    ? PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === productTypeSlug)?.nameZh
    : undefined
  const typeSegment = typeZh ? ` ${typeZh}` : ''
  return `"${brandName}"${typeSegment} 品牌 介紹 評價 推薦 通路 -徵才 -104 -人力 -site:formoria.com`
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
      const searchResults = await batchSearchBrandsWithSnippets(
        ctx.chunkBrandNames,
        queryTemplate,
        5,
        (brandName) => {
          const brand = ctx.chunk.find((candidate) => getDisplayBrandName(candidate) === brandName)
          if (!brand) throw new Error(`Missing enrichment target for ${brandName}`)
          return {
            target: { type: ctx.targetType ?? 'brand', id: brand.id },
            ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
            supabase: ctx.supabase,
            dryRun: ctx.dryRun,
            config: buildSerpConfig(),
          }
        },
      )
      const serpHits = [...searchResults.values()].filter(
        (searchResult) => searchResult.snippets.length > 0 || searchResult.urls.length > 0
      ).length
      const serpMisses = searchResults.size - serpHits
      const callFailures = [...searchResults.values()].filter((searchResult) =>
        searchResult.callStatus && !['succeeded', 'empty'].includes(searchResult.callStatus),
      )
      const callStatusDetail = callFailures.length > 0
        ? `; ${callFailures.length} call(s) failed${callFailures.some((result) => result.error) ? `: ${callFailures.flatMap((result) => result.error ? [result.error] : []).join(' | ')}` : ''}`
        : ''
      ctx.onProgress?.(
        `  [SERP] ${callFailures.length > 0 ? 'PARTIAL' : 'OK'} — ${serpHits}/${searchResults.size} brands with results${serpMisses > 0 ? ` (${serpMisses} empty)` : ''}${callStatusDetail}`
      )

      const changedFields: string[] = !ctx.dryRun &&
        [...searchResults.values()].some((searchResult) => searchResult.snippets.length > 0 || searchResult.urls.length > 0)
        ? ['serp_search_results']
        : []

      return { searchResults, searchError: null, changedFields, detail: callStatusDetail.slice(2) || undefined }
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
      result.searchError ?? undefined,
      result.detail,
    ),
    searchResults: result.searchResults,
    searchError: result.searchError,
  }
}

export async function loadCachedSearchResults(
  targetIds: string[],
  targetType: EnrichmentTarget['type'] = 'brand'
): Promise<Map<string, SearchPhaseResult>> {
  const cached = await getLatestSearchResults(targetIds, 'serp', targetType)
  const searchResults = new Map<string, SearchPhaseResult>()

  for (const [brandId, row] of cached) {
    searchResults.set(brandId, {
      urls: row.urls,
      snippets: row.snippets,
      entries: parseBrandSearchEntries(row.rawResponse),
      rawEntries: row.rawResponse,
      callStatus: row.callStatus,
      httpStatus: row.httpStatus,
      error: row.error,
      auditResultId: row.id,
      latencyMs: row.latencyMs,
    })
  }

  return searchResults
}
