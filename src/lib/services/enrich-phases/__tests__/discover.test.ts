import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDiscoverPhase } from '../discover'
import { isProviderFailure } from '../types'
import type { BatchPhaseContext, SearchPhaseResult } from '../types'
import type { EnrichBrand } from '../types'

const mocks = vi.hoisted(() => ({
  batchSearchBrandsWithSnippets: vi.fn(),
}))

vi.mock('../scraper/search', () => ({
  batchSearchBrandsWithSnippets: mocks.batchSearchBrandsWithSnippets,
  parseBrandSearchEntries: () => [],
}))

function brand(id: string, name: string): EnrichBrand {
  return { id, slug: id, name } as EnrichBrand
}

function searchResult(overrides: Partial<SearchPhaseResult> = {}): SearchPhaseResult {
  return {
    urls: [],
    snippets: [],
    entries: [],
    rawEntries: null,
    callStatus: 'succeeded',
    httpStatus: 200,
    error: null,
    latencyMs: 10,
    ...overrides,
  } as SearchPhaseResult
}

function context(brands: EnrichBrand[]): BatchPhaseContext {
  return {
    chunk: brands,
    chunkBrandNames: brands.map((b) => b.name ?? b.slug),
    phases: ['discover'],
    dryRun: false,
    supabase: {},
  } as unknown as BatchPhaseContext
}

const CREDIT_ERROR = 'Serper HTTP 400'

describe('runDiscoverPhase provider-failure reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the phase as failed when every call hits a provider failure', async () => {
    const brands = [brand('a', 'Brand A'), brand('b', 'Brand B')]
    mocks.batchSearchBrandsWithSnippets.mockResolvedValue(
      new Map([
        ['Brand A', searchResult({ callStatus: 'failed', httpStatus: 400, error: CREDIT_ERROR })],
        ['Brand B', searchResult({ callStatus: 'failed', httpStatus: 400, error: CREDIT_ERROR })],
      ])
    )

    const { phaseResult, searchError } = await runDiscoverPhase(context(brands))

    expect(phaseResult.status).toBe('failed')
    expect(phaseResult.error).toContain(CREDIT_ERROR)
    // searchError stays null: it means "the whole batch threw", and
    // curation-operations rethrows it for every brand in the chunk.
    expect(searchError).toBeNull()
  })

  it('stays succeeded on a partial failure but keeps each brand its own callStatus', async () => {
    const brands = [brand('a', 'Brand A'), brand('b', 'Brand B')]
    mocks.batchSearchBrandsWithSnippets.mockResolvedValue(
      new Map([
        ['Brand A', searchResult({ callStatus: 'succeeded', urls: ['https://a.example'] })],
        ['Brand B', searchResult({ callStatus: 'failed', httpStatus: 400, error: CREDIT_ERROR })],
      ])
    )

    const { phaseResult, searchResults } = await runDiscoverPhase(context(brands))

    expect(phaseResult.status).toBe('succeeded')
    // The failed brand must still be present — the per-target gate cannot
    // see what is missing from the map.
    expect(searchResults.get('Brand B')?.callStatus).toBe('failed')
    expect(searchResults.get('Brand A')?.callStatus).toBe('succeeded')
  })

  it('treats an all-empty batch as a success, not a provider failure', async () => {
    const brands = [brand('a', 'Brand A')]
    mocks.batchSearchBrandsWithSnippets.mockResolvedValue(
      new Map([['Brand A', searchResult({ callStatus: 'empty', httpStatus: 200 })]])
    )

    const { phaseResult, searchError } = await runDiscoverPhase(context(brands))

    expect(phaseResult.status).toBe('succeeded')
    expect(searchError).toBeNull()
  })
})

describe('isProviderFailure', () => {
  it('excludes malformed on purpose', () => {
    // `malformed` is ambiguous — it fires both on a real provider fault and on
    // a payload shape we failed to anticipate. Treating it as a provider
    // failure would hard-fail brands that merely have an unusual response.
    expect(isProviderFailure('malformed')).toBe(false)
  })

  it('is true only for unambiguous transport failures', () => {
    expect(isProviderFailure('failed')).toBe(true)
    expect(isProviderFailure('timeout')).toBe(true)
    expect(isProviderFailure('network_error')).toBe(true)
  })

  it('is false for healthy and unknown statuses', () => {
    expect(isProviderFailure('succeeded')).toBe(false)
    expect(isProviderFailure('empty')).toBe(false)
    expect(isProviderFailure('started')).toBe(false)
    expect(isProviderFailure(undefined)).toBe(false)
  })
})
