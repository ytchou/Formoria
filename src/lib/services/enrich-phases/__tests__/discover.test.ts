import { describe, expect, it, vi } from 'vitest'
import { buildSerpQuery, loadCachedSearchResults, runDiscoverPhase } from '../discover'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'

const searchResultMocks = vi.hoisted(() => ({
  finishSearchAudit: vi.fn(),
  getLatestSearchResults: vi.fn(),
  startSearchAudit: vi.fn(),
}))

vi.mock('@/lib/services/search-results', () => searchResultMocks)

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
}

function ctx(overrides: Partial<BatchPhaseContext> = {}): BatchPhaseContext {
  return {
    chunk: [brand],
    chunkBrandNames: ['Test Brand'],
    phases: ['discover'] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext['supabase'],
    ...overrides,
  }
}

describe('runDiscoverPhase', () => {
  it('returns skipped when discover is not in requested phases', async () => {
    const result = await runDiscoverPhase(ctx({ phases: ['links'] as EnrichPhase[] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.searchResults.size).toBe(0)
    expect(result.searchError).toBeNull()
  })

  it('returns skipped when chunk is empty', async () => {
    const result = await runDiscoverPhase(ctx({ chunk: [], chunkBrandNames: [] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.searchResults.size).toBe(0)
    expect(result.searchError).toBeNull()
  })
})

describe('buildSerpQuery', () => {
  it('includes 通路 in the query string', () => {
    const query = buildSerpQuery('AROMASE')
    expect(query).toContain('通路')
    expect(query).toContain('"AROMASE"')
    expect(query).toContain('品牌')
  })

  it('includes product type when provided', () => {
    const query = buildSerpQuery('AROMASE', 'hair-care')
    expect(query).toContain('通路')
  })
})

describe('loadCachedSearchResults', () => {
  it('uses the same normalized structured entries as live SERP calls', async () => {
    searchResultMocks.getLatestSearchResults.mockResolvedValue(
      new Map([
        [
          'brand-1',
          {
            brandId: 'brand-1',
            id: 'audit-1',
            searchType: 'serp',
            query: 'Test Brand',
            urls: ['https://example.com/page?srsltid=tracking'],
            snippets: ['Brand — Excerpt'],
            rawResponse: {
              organic: [
                {
                  title: 'Brand',
                  link: 'https://example.com/page?srsltid=tracking',
                  snippet: 'Excerpt',
                  position: 1,
                },
                {
                  title: 'Google result',
                  link: 'https://www.google.com/search?q=Test+Brand',
                  snippet: 'Should be filtered',
                  position: 2,
                },
              ],
            },
            callStatus: 'succeeded',
            httpStatus: 200,
            error: null,
            latencyMs: 4,
          },
        ],
      ]),
    )

    const results = await loadCachedSearchResults(['brand-1'])

    expect(results.get('brand-1')?.entries).toEqual([
      {
        title: 'Brand',
        link: 'https://example.com/page',
        snippet: 'Excerpt',
        position: 1,
      },
    ])
  })
})
