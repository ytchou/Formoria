import { describe, expect, it } from 'vitest'
import { buildSerpQuery, runDiscoverPhase } from '../discover'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'

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
