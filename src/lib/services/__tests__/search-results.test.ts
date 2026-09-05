import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  getLatestSearchResults,
  isFreshSearchResult,
  type SearchResultRow,
} from '../search-results'

function makeRow(overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    brandId: 'brand-1',
    searchType: 'serp',
    query: 'test',
    urls: ['https://example.com'],
    snippets: [],
    ...overrides,
  }
}

const THREE_DAYS_MS = 3 * 86_400_000

describe('isFreshSearchResult', () => {
  const now = new Date('2026-09-04T00:00:00Z').getTime()

  it('rejects rows older than the max age', () => {
    const row = makeRow({
      createdAt: new Date('2026-08-30T00:00:00Z').toISOString(), // 5 days ago
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })

  it('accepts rows within the max age', () => {
    const row = makeRow({
      createdAt: new Date('2026-09-03T00:00:00Z').toISOString(), // 1 day ago
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(true)
  })

  it('rejects rows with no URLs regardless of age', () => {
    const row = makeRow({
      createdAt: new Date('2026-09-03T12:00:00Z').toISOString(),
      urls: [],
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })

  it('rejects rows with no createdAt', () => {
    const row = makeRow({ createdAt: undefined })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })
})

/**
 * The query builder terminates in an awaited thenable, so the fake is a
 * self-returning proxy holding one fixed payload. The service filters by query
 * kind in JS after the select, so every row is handed back here.
 */
function fakeSupabase(rows: Array<Record<string, unknown>>): SupabaseClient<Database> {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  for (const method of ['select', 'in', 'eq', 'order']) {
    chain[method] = () => chain
  }
  return { from: () => chain } as unknown as SupabaseClient<Database>
}

describe('getLatestSearchResults', () => {
  const rows = [
    {
      brand_id: 'brand-1',
      id: 'row-handle',
      search_type: 'serp',
      query: '"1woof"',
      urls: ['https://pinkoi.com/store/1woof'],
      snippets: [],
      config: { phase: 'acquire', queryKind: 'handle' },
      created_at: '2026-09-04T00:00:00Z',
    },
    {
      brand_id: 'brand-1',
      id: 'row-name',
      search_type: 'serp',
      query: 'One Wood',
      urls: ['https://example.com/'],
      snippets: [],
      config: { phase: 'acquire' },
      created_at: '2026-09-03T00:00:00Z',
    },
    {
      brand_id: 'brand-2',
      id: 'row-legacy',
      search_type: 'serp',
      query: 'Other Brand',
      urls: ['https://other.example/'],
      snippets: [],
      config: null,
      created_at: '2026-09-02T00:00:00Z',
    },
  ]

  it('get_latest_search_results_filters_by_query_kind', async () => {
    const supabase = fakeSupabase(rows)

    const nameResults = await getLatestSearchResults(
      ['brand-1', 'brand-2'],
      'serp',
      'brand',
      'name',
      supabase,
    )
    expect(nameResults.get('brand-1')?.id).toBe('row-name')
    expect(nameResults.get('brand-2')?.id).toBe('row-legacy')

    const handleResults = await getLatestSearchResults(
      ['brand-1', 'brand-2'],
      'serp',
      'brand',
      'handle',
      supabase,
    )
    expect(handleResults.get('brand-1')?.id).toBe('row-handle')
    expect(handleResults.has('brand-2')).toBe(false)

    const anyKind = await getLatestSearchResults(
      ['brand-1', 'brand-2'],
      'serp',
      'brand',
      undefined,
      supabase,
    )
    expect(anyKind.get('brand-1')?.id).toBe('row-handle')
    expect(anyKind.get('brand-2')?.id).toBe('row-legacy')
  })
})
