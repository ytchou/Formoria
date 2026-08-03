import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateLlmProviderGate,
  evaluateProviderGate,
  hasNoEnrichmentInputs,
  isLlmProviderFailureMessage,
  isProviderFailureMessage,
  llmStageFailure,
  serpStageFailure,
} from '../curation-operations'
import type { PhaseResult } from '@/lib/types/curation'
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

/**
 * Gate C is the LLM counterpart of Gate A and is tested the same way: as the
 * pure decision helper `runEnrich` branches on. It differs from Gate A in WHEN
 * it can fire — a search outage is visible in data the pipeline already holds,
 * an LLM outage is only discoverable by calling — so the helper takes the
 * brand's accumulated phase results rather than a provider response.
 */
function phase(
  name: string,
  status: PhaseResult['status'],
  extra: Partial<PhaseResult> = {}
): PhaseResult {
  return { phase: name, status, changedFields: [], durationMs: 0, ...extra }
}

describe('Gate C — llmStageFailure', () => {
  it('fails the target when every attempted LLM phase failed at the provider', () => {
    const decision = evaluateLlmProviderGate([
      phase('links', 'succeeded'),
      phase('descriptions', 'failed', { providerFailure: true }),
      phase('classify_images', 'failed', { providerFailure: true }),
    ])

    expect(decision?.action).toBe('fail')
    expect(decision?.message).toContain('LLM provider unavailable')
    expect(decision?.message).toContain('descriptions')
    expect(decision?.message).toContain('classify_images')
  })

  // The regression that matters most: on 2026-08-02 the run went green because
  // an empty result was indistinguishable from an outage. Over-correcting the
  // other way — failing every brand the model had nothing to say about — would
  // be just as wrong, so a healthy phase always clears the gate.
  it('does not fire when a single LLM phase got through', () => {
    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'succeeded'),
        phase('classify_images', 'failed', { providerFailure: true }),
      ])
    ).toBeNull()
  })

  it('does not fire on an LLM failure that was not a provider failure', () => {
    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'failed', { error: 'persist blew up' }),
      ])
    ).toBeNull()
  })

  it('ignores skipped LLM phases when deciding what was attempted', () => {
    // Scope-skipped phases are not attempts. A run whose only attempted LLM
    // phase died still fails; a run where everything was skipped does not.
    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'skipped'),
        phase('classify_images', 'failed', { providerFailure: true }),
      ])?.action
    ).toBe('fail')
    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'skipped'),
        phase('classify_images', 'skipped'),
      ])
    ).toBeNull()
  })

  it('ignores non-LLM phases entirely', () => {
    // A failed Serper phase is Gate A's business; Gate C must not double-count
    // it, or a search outage would be reported as an OpenAI outage.
    expect(
      evaluateLlmProviderGate([
        phase('discover', 'failed', { providerFailure: true }),
        phase('links', 'failed'),
      ])
    ).toBeNull()
    expect(llmStageFailure([])).toBeNull()
  })

  it('downgrades to a warning when CURATION_PROVIDER_GATE=off', () => {
    process.env.CURATION_PROVIDER_GATE = 'off'

    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'failed', { providerFailure: true }),
      ])?.action
    ).toBe('warn')
  })

  it('stays active for any value other than off', () => {
    process.env.CURATION_PROVIDER_GATE = 'on'

    expect(
      evaluateLlmProviderGate([
        phase('descriptions', 'failed', { providerFailure: true }),
      ])?.action
    ).toBe('fail')
  })
})

describe('isProviderFailureMessage', () => {
  it('accepts both the Serper and the LLM prefix', () => {
    // One predicate for both gates: the job summary counts them together, and
    // an operator's response ("stop the run, fix the account") is identical.
    expect(isProviderFailureMessage('Search provider unavailable — SERP: 400')).toBe(true)
    expect(
      isProviderFailureMessage('LLM provider unavailable — every attempted LLM phase failed at the provider: descriptions')
    ).toBe(true)
    expect(isProviderFailureMessage('No usable enrichment inputs')).toBe(false)
    expect(isProviderFailureMessage(null)).toBe(false)
  })

  it('separates the LLM half for the circuit breaker', () => {
    expect(isLlmProviderFailureMessage('Search provider unavailable — SERP: 400')).toBe(false)
    expect(isLlmProviderFailureMessage('LLM provider unavailable — x')).toBe(true)
  })
})
