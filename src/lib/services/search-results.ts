import { createServiceClient } from '@/lib/supabase/server'
import { brandTarget, targetForeignKey, type EnrichmentTarget } from './enrichment-target'

export type SearchType = 'serp' | 'image' | 'scrape'

export type SearchResultRow = {
  brandId: string
  searchType: SearchType
  query: string
  urls: string[]
  snippets: string[]
}

export async function insertSearchResult(
  targetOrBrandId: EnrichmentTarget | string,
  searchType: SearchType,
  query: string,
  urls: string[],
  snippets: string[],
  rawResponse?: unknown,
  config?: unknown,
  latencyMs?: number,
  jobId?: string,
): Promise<void> {
  const supabase = createServiceClient()
  const target = typeof targetOrBrandId === 'string'
    ? brandTarget(targetOrBrandId)
    : targetOrBrandId
  const { error } = await supabase.from('brand_search_results').insert({
    ...targetForeignKey(target),
    job_id: jobId ?? null,
    search_type: searchType,
    query,
    urls,
    snippets,
    raw_response: rawResponse ?? null,
    config: config ?? null,
    latency_ms: latencyMs ?? null,
  })
  if (error) console.error(`  [SEARCH-RESULTS] insertSearchResult failed:`, error.message)
}

export async function getLatestSearchResults(
  targetIds: string[],
  searchType: SearchType,
  targetType: EnrichmentTarget['type'] = 'brand'
): Promise<Map<string, SearchResultRow>> {
  if (targetIds.length === 0) return new Map()
  const supabase = createServiceClient()
  const foreignKey = targetType === 'brand' ? 'brand_id' : 'submission_id'
  const { data } = await supabase
    .from('brand_search_results')
    .select(`${foreignKey}, search_type, query, urls, snippets`)
    .in(foreignKey, targetIds)
    .eq('search_type', searchType)
    .order('created_at', { ascending: false })

  const results = new Map<string, SearchResultRow>()
  for (const row of data ?? []) {
    const targetId = (row as Record<string, unknown>)[foreignKey]
    if (typeof targetId !== 'string' || results.has(targetId)) continue
    results.set(targetId, {
      brandId: targetId,
      searchType: row.search_type as SearchType,
      query: row.query,
      urls: row.urls ?? [],
      snippets: row.snippets ?? [],
    })
  }
  return results
}
