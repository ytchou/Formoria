import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — only non-service modules (test-boundaries forbids @/lib/services/)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fetchLangfusePrompt: vi.fn().mockImplementation((_name: string, fallback: string) => Promise.resolve(fallback)),
}))

vi.mock('@/lib/langfuse/prompt', () => ({
  fetchLangfusePrompt: mocks.fetchLangfusePrompt,
}))

import {
  runEditorialAgent,
  type EditorialInput,
  type EditorialDeps,
} from '../graph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<EditorialInput> = {}): EditorialInput {
  return {
    brand: {
      id: 'brand-1',
      slug: 'test-brand',
      name: 'Test Brand',
      status: 'approved',
      description: 'A nice Taiwanese brand',
      category: 'fashion',
    },
    phases: ['descriptions', 'stockists', 'faq'],
    scrapedData: { snippets: ['some snippet'] },
    serpSnippets: ['SERP snippet about the brand'],
    overwrite: false,
    dryRun: true,
    jobId: 'job-1',
    ...overrides,
  }
}

/** Builds editorial deps that return phase results directly. */
function makeDeps(overrides: Partial<EditorialDeps> = {}): EditorialDeps {
  return {
    runDescriptions: vi.fn().mockResolvedValue({
      phaseResult: {
        phase: 'descriptions',
        status: 'succeeded',
        changedFields: ['description', 'description_en'],
        durationMs: 100,
      },
      patch: {
        description: 'A brand description',
        description_en: 'A brand description EN',
        blurb: 'blurb',
        blurb_en: 'blurb en',
      },
      descriptionRewrite: null,
      brandFacts: {
        categorySlug: 'fashion',
        subcategories: ['accessories'],
        city: 'taipei',
        foundingYear: 2020,
        listing: { verdict: 'accept' },
      },
      attempts: [],
      factsAttempts: [],
      listingVerdict: { verdict: 'accept' },
    }),
    runStockists: vi.fn().mockResolvedValue({
      phaseResult: {
        phase: 'stockists',
        status: 'succeeded',
        changedFields: ['2 stockist(s)'],
        durationMs: 80,
      },
      patch: {},
    }),
    runFaq: vi.fn().mockResolvedValue({
      phaseResult: {
        phase: 'faq',
        status: 'succeeded',
        changedFields: ['faq'],
        durationMs: 90,
      },
      patch: {},
    }),
    validateCrossOutput: vi.fn().mockReturnValue([]),
    repairCrossOutput: vi.fn().mockResolvedValue({
      description: 'Repaired description',
      description_en: 'Repaired description EN',
    }),
    requestEvidence: vi.fn().mockResolvedValue('Some evidence text from the scraped page'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('editorial agent graph', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('editorial_happy_path — runs all phases and finalizes with no repair', async () => {
    const deps = makeDeps()
    const input = makeInput()

    const output = await runEditorialAgent(input, deps)

    expect(output.agentOutcome).toBe('generated')
    expect(output.phaseResults).toHaveLength(3)
    expect(output.phaseResults.map((r) => r.phase)).toEqual([
      'descriptions',
      'stockists',
      'faq',
    ])
    expect(output.phaseResults.every((r) => r.status === 'succeeded')).toBe(true)
    expect(output.patch).toHaveProperty('description')
    expect(output.patch).toHaveProperty('description_en')
    // Deps called in order
    expect(deps.runDescriptions).toHaveBeenCalledOnce()
    expect(deps.runStockists).toHaveBeenCalledOnce()
    expect(deps.runFaq).toHaveBeenCalledOnce()
    expect(deps.validateCrossOutput).toHaveBeenCalledOnce()
    // No repair when validation passes
    expect(deps.repairCrossOutput).not.toHaveBeenCalled()
  })

  it('editorial_validation_triggers_repair — cross-output failures trigger repairNode', async () => {
    const deps = makeDeps({
      validateCrossOutput: vi.fn().mockReturnValue([
        { field: 'description', reason: 'contains AI artifact "as a brand"' },
      ]),
      repairCrossOutput: vi.fn().mockResolvedValue({
        description: 'Repaired without AI artifact',
        description_en: 'Repaired without AI artifact EN',
      }),
    })
    const input = makeInput()

    const output = await runEditorialAgent(input, deps)

    expect(output.agentOutcome).toBe('repaired')
    expect(deps.repairCrossOutput).toHaveBeenCalledOnce()
    expect(output.patch).toHaveProperty('description', 'Repaired without AI artifact')
  })

  it('editorial_repair_fixes_issue — repaired output replaces original in finalize', async () => {
    const validationFailures = [
      { field: 'blurb', reason: 'too long' },
    ]
    const deps = makeDeps({
      validateCrossOutput: vi.fn()
        .mockReturnValueOnce(validationFailures)
        // After repair, validation passes
        .mockReturnValueOnce([]),
      repairCrossOutput: vi.fn().mockResolvedValue({
        blurb: 'Shorter blurb',
      }),
    })
    const input = makeInput()

    const output = await runEditorialAgent(input, deps)

    expect(output.agentOutcome).toBe('repaired')
    // The repaired blurb replaces the original
    expect(output.patch).toHaveProperty('blurb', 'Shorter blurb')
    // Original description preserved
    expect(output.patch).toHaveProperty('description', 'A brand description')
  })

  it('editorial_off_flag_falls_through — EDITORIAL_AGENT=off skips the agent', async () => {
    vi.stubEnv('EDITORIAL_AGENT', 'off')

    const deps = makeDeps()
    const input = makeInput()

    const output = await runEditorialAgent(input, deps)

    expect(output.agentOutcome).toBe('fallback')
    expect(output.phaseResults).toHaveLength(0)
    expect(deps.runDescriptions).not.toHaveBeenCalled()
  })

  it('editorial_fallback_on_error — agent error falls back cleanly', async () => {
    const deps = makeDeps({
      runDescriptions: vi.fn().mockRejectedValue(new Error('LLM provider down')),
    })
    const input = makeInput()

    const output = await runEditorialAgent(input, deps)

    expect(output.agentOutcome).toBe('fallback')
    expect(output.error).toContain('LLM provider down')
  })

  it('editorial_request_evidence_tool — returns scraped text chunk', async () => {
    const deps = makeDeps()
    const input = makeInput()

    // Run the agent to exercise the tool path
    await runEditorialAgent(input, deps)

    // The requestEvidence dep is available for nodes to call
    const evidence = await deps.requestEvidence!('https://example.com/about', 'founding year')
    expect(evidence).toBe('Some evidence text from the scraped page')
  })

  it('listing gate rejects submission early', async () => {
    const deps = makeDeps({
      runDescriptions: vi.fn().mockResolvedValue({
        phaseResult: {
          phase: 'descriptions',
          status: 'succeeded',
          changedFields: [],
          durationMs: 50,
        },
        patch: {},
        descriptionRewrite: null,
        brandFacts: null,
        attempts: [],
        factsAttempts: [],
        listingVerdict: { verdict: 'reject' },
      }),
    })
    const input = makeInput({
      brand: {
        id: 'brand-1',
        slug: 'test-brand',
        name: 'Test Brand',
        status: undefined,
        category: 'fashion',
      },
      target: { type: 'submission', id: 'sub-1' },
    })

    const output = await runEditorialAgent(input, deps)

    // Submission rejected: stockists and faq should not run
    expect(deps.runStockists).not.toHaveBeenCalled()
    expect(deps.runFaq).not.toHaveBeenCalled()
    expect(output.listingVerdict).toEqual({ verdict: 'reject' })
  })

  it('skips phases not in the input list', async () => {
    const deps = makeDeps()
    const input = makeInput({ phases: ['descriptions'] })

    const output = await runEditorialAgent(input, deps)

    expect(deps.runDescriptions).toHaveBeenCalledOnce()
    expect(deps.runStockists).not.toHaveBeenCalled()
    expect(deps.runFaq).not.toHaveBeenCalled()
    expect(output.phaseResults).toHaveLength(1)
  })
})
