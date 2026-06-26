import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runImageSearchPhase } from '../image-search'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'
import { batchSearchBrandImages } from '../../scraper/search'

vi.mock('../../scraper/search', () => ({
  batchSearchBrandImages: vi.fn(),
}))

vi.mock('../../search-results', () => ({
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
    phases: ['images'] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext['supabase'],
    ...overrides,
  }
}

describe('runImageSearchPhase', () => {
  beforeEach(() => {
    vi.mocked(batchSearchBrandImages).mockReset()
  })

  it('returns skipped when images is not in requested phases', async () => {
    const result = await runImageSearchPhase(ctx({ phases: ['links'] as EnrichPhase[] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
    expect(batchSearchBrandImages).not.toHaveBeenCalled()
  })

  it('returns skipped when chunk is empty', async () => {
    const result = await runImageSearchPhase(ctx({ chunk: [], chunkBrandNames: [] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
    expect(batchSearchBrandImages).not.toHaveBeenCalled()
  })
})
