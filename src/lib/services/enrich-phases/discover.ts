import type { PhaseResult, PhaseStatus } from '@/lib/types/curation'
import { auditedCall } from '@/lib/audit'
import { batchSearchBrandsWithSnippets, parseBrandSearchEntries } from './scraper/search'
import { getLatestSearchResults } from '../search-results'
import { buildSerpConfig } from '@/lib/constants/enrichment-config'
import type { EnrichmentTarget } from '../_shared/enrichment-target'
import {
  buildPhaseResult,
  getDisplayBrandName,
  isProviderFailure,
  timePhase,
  type BatchPhaseContext,
  type SearchPhaseResult,
} from './types'

const MAX_PROVIDER_ERROR_LENGTH = 500

type DiscoverAttempt = {
  searchResults: Map<string, SearchPhaseResult>
  searchError: string | null
  changedFields: string[]
  detail: string | undefined
  status: PhaseStatus
  providerError: string | null
}

/**
 * The brand's name, and nothing else.
 *
 * This phase's job is finding the brand's URLs — its own site, its Instagram,
 * its marketplace storefronts — which everything downstream depends on. The
 * query used to carry editorial qualifiers (`品牌 介紹 評價 推薦 通路`) plus
 * recruitment negatives, added to bias the snippets toward write-ups about the
 * brand. Measured against a bare-name search, those qualifiers were destroying
 * the primary job:
 *
 *   HANDMADESHIP, bare          HANDMADESHIP, with qualifiers
 *   instagram.com/handmadeship  instagram.com/p/DQeL94sEv9G   (a post)
 *   pinkoi.com/store/...        threads.com/@nuomi0213/...    (a stranger)
 *   handmadeshiphk.com          biggo.com.tw/s/行李牌          (an aggregator)
 *   facebook.com/...
 *
 * The bare query returned the official site, the Instagram profile, the
 * Facebook profile and the Pinkoi store — every link field we store. The
 * qualified one returned none of them, and its first result is where the
 * post-permalink-as-a-profile defect came from.
 *
 * Unquoted for the same reason the image query is: stored names are bilingual
 * concatenations and quoting demands an adjacency the brand's own pages often
 * do not use.
 *
 * `-site:formoria.com` stays. Our own brand pages rank for these names, and
 * scraping ourselves would feed the pipeline its own previous output.
 *
 * No product category either: it is decided downstream now, so reading it here
 * would mean reading the previous run's answer.
 */
function buildSerpQuery(brandName: string): string {
  return `${brandName} -site:formoria.com`
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
  return auditedCall(
    { provider: 'enrich', operation: 'runDiscoverPhase', kind: 'service' },
    async () => {
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

  const queryTemplate = (name: string) => buildSerpQuery(name)

  const { result, durationMs } = await timePhase(async (): Promise<DiscoverAttempt> => {
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
        isProviderFailure(searchResult.callStatus),
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

      // Every call hitting a provider failure means the provider is down, not
      // that these brands have no coverage — surface it as a failed phase.
      // A partial failure stays `succeeded` at the batch level; the per-brand
      // callStatus in `searchResults` is what the per-target gate reads.
      const allCallsFailed = searchResults.size > 0 && callFailures.length === searchResults.size
      const providerError = allCallsFailed ? summarizeProviderErrors(callFailures) : null

      return {
        searchResults,
        searchError: null,
        changedFields,
        detail: callStatusDetail.slice(2) || undefined,
        status: (allCallsFailed ? 'failed' : 'succeeded'),
        providerError,
      }
    } catch (err) {
      const searchError = errorMessage(err)
      ctx.onProgress?.(`  [SERP] FAILED — ${searchError}`)
      return {
        searchResults: new Map<string, SearchPhaseResult>(),
        searchError,
        changedFields: [],
        detail: undefined,
        status: 'failed',
        providerError: null,
      }
    }
  })

  return {
    phaseResult: buildPhaseResult(
      'discover',
      result.searchError ? 'failed' : result.status,
      result.changedFields,
      durationMs,
      result.searchError ?? result.providerError ?? undefined,
      result.detail,
    ),
    searchResults: result.searchResults,
    // `searchError` means "the whole batch threw" — curation-operations rethrows
    // it for every brand in the chunk, so per-call failures must not set it.
    searchError: result.searchError,
  }
    },
  )
}

function summarizeProviderErrors(callFailures: SearchPhaseResult[]): string {
  const distinct = [...new Set(callFailures.flatMap((failure) => (failure.error ? [failure.error] : [])))]
  const summary = distinct.length > 0
    ? `All ${callFailures.length} search call(s) failed: ${distinct.join(' | ')}`
    : `All ${callFailures.length} search call(s) failed`
  return summary.slice(0, MAX_PROVIDER_ERROR_LENGTH)
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
      fromCache: true,
    })
  }

  return searchResults
}
