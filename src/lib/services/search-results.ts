import { createServiceClient } from '@/lib/supabase/server'

export type SearchResultRow = {
  brandId: string
  searchType: 'serp' | 'image'
  query: string
  urls: string[]
  snippets: string[]
}

export async function insertSearchResult(
  brandId: string,
  searchType: 'serp' | 'image',
  query: string,
  urls: string[],
  snippets: string[],
  rawResponse?: unknown
): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('brand_search_results').insert({
    brand_id: brandId,
    search_type: searchType,
    query,
    urls,
    snippets,
    raw_response: rawResponse ?? null,
  })
}

export async function getLatestSearchResults(
  brandIds: string[],
  searchType: 'serp' | 'image'
): Promise<Map<string, SearchResultRow>> {
  if (brandIds.length === 0) return new Map()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('brand_search_results')
    .select('brand_id, search_type, query, urls, snippets')
    .in('brand_id', brandIds)
    .eq('search_type', searchType)
    .order('created_at', { ascending: false })

  const results = new Map<string, SearchResultRow>()
  for (const row of data ?? []) {
    if (results.has(row.brand_id)) continue
    results.set(row.brand_id, {
      brandId: row.brand_id,
      searchType: row.search_type as 'serp' | 'image',
      query: row.query,
      urls: row.urls ?? [],
      snippets: row.snippets ?? [],
    })
  }
  return results
}
