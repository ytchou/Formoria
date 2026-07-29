import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateProviderGate,
  hasNoEnrichmentInputs,
  serpStageFailure,
} from '../curation-operations'
import type { SearchPhaseResult } from '../enrich-phases'
import type { BrandImageSearchOutcome } from '../enrich-phases/scraper/types'

/**
 * The two pipeline gates are tested as pure decision helpers rather than by
 * mocking the whole per-brand loop. The loop needs Supabase, progress plumbing
 * and every phase module stubbed, and the resulting mega-mock asserts more about
 * the mocks than about the gates. Both helpers are the single source of truth
 * for the decision — `runEnrich` only branches on their return value, and both
 * calls sit before `runCleanPhase`, so no LLM phase can run past them.
 */

function searchResult(
  overrides: Partial<SearchPhaseResult> = {}
): SearchPhaseResult {
  return { urls: [], snippets: [], ...overrides }
}

function imageOutcome(
  overrides: Partial<BrandImageSearchOutcome> = {}
): BrandImageSearchOutcome {
  return { rows: [], callStatus: 'succeeded', httpStatus: 200, error: null, ...overrides }
}

const emptyInputs = {
  knownUrls: [],
  discoveredUrls: [],
  urlExtracted: {},
  imageSearchUrls: [],
  serpSnippets: [],
}

afterEach(() => {
  delete process.env.CURATION_PROVIDER_GATE
})

describe('Gate A — serpStageFailure', () => {
  it('fails the target when the SERP call failed at the provider', () => {
    const decision = evaluateProviderGate({
      searchResult: searchResult({
        callStatus: 'failed',
        httpStatus: 400,
        error: 'Serper HTTP 400',
      }),
    })

    expect(decision).toEqual({
      action: 'fail',
      message: 'Search provider unavailable — SERP: Serper HTTP 400',
    })
  })

  it('fails the target when the image search call failed at the provider', () => {
    const decision = evaluateProviderGate({
      searchResult: searchResult({ callStatus: 'succeeded', snippets: ['a snippet'] }),
      imageOutcome: imageOutcome({
        callStatus: 'network_error',
        httpStatus: null,
        error: 'fetch failed',
      }),
    })

    expect(decision?.action).toBe('fail')
    expect(decision?.message).toContain('image search')
  })

  it('does not fail on a replayed cached result carrying a historical failure', () => {
    expect(
      serpStageFailure({
        searchResult: searchResult({
          callStatus: 'failed',
          httpStatus: 400,
          error: 'Serper HTTP 400',
          fromCache: true,
        }),
      })
    ).toBeNull()
    expect(
      evaluateProviderGate({
        searchResult: searchResult({ callStatus: 'failed', fromCache: true }),
      })
    ).toBeNull()
  })

  it('does not fail on malformed responses or successful calls', () => {
    expect(
      serpStageFailure({ searchResult: searchResult({ callStatus: 'malformed' }) })
    ).toBeNull()
    expect(
      serpStageFailure({
        searchResult: searchResult({ callStatus: 'succeeded' }),
        imageOutcome: imageOutcome(),
      })
    ).toBeNull()
    expect(serpStageFailure({})).toBeNull()
  })

  it('downgrades to a warning when CURATION_PROVIDER_GATE=off', () => {
    process.env.CURATION_PROVIDER_GATE = 'off'

    const decision = evaluateProviderGate({
      searchResult: searchResult({ callStatus: 'failed', error: 'Serper HTTP 400' }),
    })

    expect(decision?.action).toBe('warn')
  })

  it('stays active for any value other than off', () => {
    process.env.CURATION_PROVIDER_GATE = 'on'

    expect(
      evaluateProviderGate({
        searchResult: searchResult({ callStatus: 'timeout' }),
      })?.action
    ).toBe('fail')
  })
})

describe('Gate B — hasNoEnrichmentInputs', () => {
  // Regression: the old gate also required `!phases.includes('tags') &&
  // !phases.includes('locations')`, which is always false for refresh jobs, so
  // every empty brand ran the full LLM tail anyway. The decision no longer looks
  // at the requested phases at all — it takes only the actual inputs.
  it('skips a brand with no urls, no patch, no images and no snippets', () => {
    expect(hasNoEnrichmentInputs(emptyInputs)).toBe(true)
  })

  it('does not skip a brand that has SERP snippets but zero urls', () => {
    expect(
      hasNoEnrichmentInputs({
        ...emptyInputs,
        serpSnippets: ['Formoria is a Taiwanese leather studio'],
      })
    ).toBe(false)
  })

  it('does not skip when any single input is present', () => {
    expect(
      hasNoEnrichmentInputs({ ...emptyInputs, knownUrls: ['https://a.tw'] })
    ).toBe(false)
    expect(
      hasNoEnrichmentInputs({ ...emptyInputs, discoveredUrls: ['https://b.tw'] })
    ).toBe(false)
    expect(
      hasNoEnrichmentInputs({
        ...emptyInputs,
        urlExtracted: { website_url: 'https://c.tw' },
      })
    ).toBe(false)
    expect(
      hasNoEnrichmentInputs({
        ...emptyInputs,
        imageSearchUrls: ['https://img.tw/1.jpg'],
      })
    ).toBe(false)
  })

  it('treats blank-only urls as no urls', () => {
    expect(
      hasNoEnrichmentInputs({ ...emptyInputs, knownUrls: ['  ', ''] })
    ).toBe(true)
  })
})
