import { createServiceClient } from '@/lib/supabase/server'

export type SearchResultRow = {
  brandId: string
  searchType: 'serp' | 'image'
  query: string
  urls: string[]
  snippets: string[]
}

export async function upsertSearchResult(
  brandId: string,
  searchType: 'serp' | 'image',
  query: string,
  urls: string[],
  snippets: string[],
  rawResponse?: unknown
): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('brand_search_results').upsert(
    {
      brand_id: brandId,
      search_type: searchType,
      query,
      urls,
      snippets,
      raw_response: rawResponse ?? null,
    },
    { onConflict: 'brand_id,search_type' }
  )
}

export async function getSearchResults(
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

  const results = new Map<string, SearchResultRow>()
  for (const row of data ?? []) {
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
