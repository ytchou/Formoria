import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDiscoverPhase, loadCachedSearchResults } from '../discover'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'
import { batchSearchBrandsWithSnippets } from '../../scraper/search'
import { getLatestSearchResults } from '../../search-results'

vi.mock('../../scraper/search', () => ({
  batchSearchBrandsWithSnippets: vi.fn(),
}))

vi.mock('../../search-results', () => ({
  getLatestSearchResults: vi.fn(),
  insertSearchResult: vi.fn(),
}))

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
  beforeEach(() => {
    vi.mocked(batchSearchBrandsWithSnippets).mockReset()
    vi.mocked(getLatestSearchResults).mockReset()
  })

  it('returns skipped when discover is not in requested phases', async () => {
    const result = await runDiscoverPhase(ctx({ phases: ['links'] as EnrichPhase[] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.searchResults.size).toBe(0)
    expect(result.searchError).toBeNull()
    expect(batchSearchBrandsWithSnippets).not.toHaveBeenCalled()
  })

  it('returns skipped when chunk is empty', async () => {
    const result = await runDiscoverPhase(ctx({ chunk: [], chunkBrandNames: [] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.searchResults.size).toBe(0)
    expect(result.searchError).toBeNull()
    expect(batchSearchBrandsWithSnippets).not.toHaveBeenCalled()
  })
})

describe('loadCachedSearchResults', () => {
  beforeEach(() => {
    vi.mocked(getLatestSearchResults).mockReset()
  })

  it('returns empty map when no cached results exist', async () => {
    vi.mocked(getLatestSearchResults).mockResolvedValue(new Map())

    const result = await loadCachedSearchResults(
      ['brand-1'],
      null as unknown as BatchPhaseContext['supabase']
    )

    expect(result.size).toBe(0)
    expect(getLatestSearchResults).toHaveBeenCalledWith(['brand-1'], 'serp')
  })
})
