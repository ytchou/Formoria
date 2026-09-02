import { describe, expect, it, vi } from 'vitest'
import type { AcquisitionDeps, AcquisitionInput } from '../graph'

// Mock external dependencies — only non-service modules (test-boundaries forbids @/lib/services/ mocks)
const mocks = vi.hoisted(() => ({
  auditedCall: vi.fn().mockImplementation((_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) => fn({ summary: {} })),
  fetchLangfusePrompt: vi.fn().mockImplementation((_name: string, fallback: string) => Promise.resolve(fallback)),
  resolveProfileModel: vi.fn().mockReturnValue('gpt-test'),
}))

vi.mock('@/lib/audit', () => ({
  auditedCall: mocks.auditedCall,
}))

vi.mock('@/lib/langfuse/prompt', () => ({
  fetchLangfusePrompt: mocks.fetchLangfusePrompt,
}))

vi.mock('@/lib/constants/llm-models', () => ({
  resolveProfileModel: mocks.resolveProfileModel,
  LLM_PROFILES: { acquisition: { model: 'text', temperature: 0.1, reasoningEffort: 'none', timeoutMs: 30_000 } },
}))

import { runAcquisition } from '../graph'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { RunnableLambda } from '@langchain/core/runnables'

/**
 * Creates a fake model that returns a sequence of responses.
 * For structured output, wraps responses in AIMessage. For plan node,
 * the model must produce JSON matching AcquisitionPlan. For critique,
 * it must produce a verdict.
 */
function fakeModel(responses: Array<Record<string, unknown>>) {
  let callIdx = 0
  return new RunnableLambda({
    func: async (_input: BaseMessage[]) => {
      const resp = responses[callIdx] ?? responses[responses.length - 1]
      callIdx++
      return new AIMessage({
        content: JSON.stringify(resp),
        usage_metadata: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })
    },
  })
}

function makeDeps(overrides: Partial<AcquisitionDeps> = {}): AcquisitionDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: '<html><body>Brand content here with enough text</body></html>', status: 200, latencyMs: 50, error: null }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({ html: '<html><body>Rendered</body></html>', finalUrl: 'https://example.com', status: 200 }),
    },
    searchBrand: vi.fn().mockResolvedValue({ urls: ['https://found.example.com'], snippets: ['brand info'] }),
    scrapeBrandUrls: vi.fn().mockResolvedValue({
      data: { name: 'Test Brand', description: 'A test brand' },
      statuses: [{ url: 'https://example.com', ok: true, classification: 'official-site', httpStatus: 200, latencyMs: 100, error: null }],
    }),
    ...overrides,
  }
}

const baseInput: AcquisitionInput = {
  brand: { id: 'brand-1', slug: 'test-brand', name: 'Test Brand' },
  knownUrls: ['https://example.com'],
  jobId: 'job-1',
}

describe('acquisition graph', () => {
  it('graph_scripted_model_produces_plan_execute_critique_finalize', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', strategy: 'official-site', reason: 'main site' },
      ],
      fanOut: [],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const verdict = { verdict: 'sufficient', reason: 'enough data' }

    const model = fakeModel([validPlan, verdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('planned')
    expect(result.plan).toBeDefined()
    expect(result.directives).toBeDefined()
    expect(result.scrapeResult).toBeDefined()
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(1)
  })

  it('graph_thin_verdict_runs_recovery_exactly_once', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', reason: 'main site' },
      ],
      fanOut: ['https://extra.com'],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const thinVerdict = { verdict: 'thin', reason: 'not enough data', recoveryAction: 'fanout' }
    const sufficientVerdict = { verdict: 'sufficient', reason: 'enough after recovery' }

    const model = fakeModel([validPlan, thinVerdict, sufficientVerdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('recovered')
    // scrapeBrandUrls called twice: once for execute, once after recovery
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(2)

    // A second thin does NOT loop — it finalizes
    const model2 = fakeModel([validPlan, thinVerdict, thinVerdict])
    const deps2 = makeDeps()
    const result2 = await runAcquisition(baseInput, deps2, { model: model2 })
    expect(result2.agentOutcome).toBe('recovered')
    expect(deps2.scrapeBrandUrls).toHaveBeenCalledTimes(2)
  })

  it('graph_invalid_plan_retries_once_then_fallback', async () => {
    // Both plan attempts return invalid data (missing required fields)
    const invalidPlan = { notAValidField: true }
    const model = fakeModel([invalidPlan, invalidPlan])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.agentOutcome).toBe('fallback')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('graph_budget_exhausted_before_plan_is_fallback', async () => {
    const deps = makeDeps()
    // Force a budget with 0 turns — plan node cannot run
    const result = await runAcquisition(
      baseInput,
      deps,
      {
        model: fakeModel([]),
        budgetOverride: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
      },
    )
    expect(result.agentOutcome).toBe('fallback')
  })

  it('budget_allowance_and_usage_are_recorded', async () => {
    const validPlan = {
      surfaces: [
        { url: 'https://example.com', fetch: 'static', reason: 'main site' },
      ],
      fanOut: [],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
    }
    const verdict = { verdict: 'sufficient', reason: 'enough' }
    const model = fakeModel([validPlan, verdict])
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })
    expect(result.budget).toBeDefined()
    expect(result.budget).toHaveProperty('allowed')
    expect(result.budget).toHaveProperty('used')
    expect(result.budget!.allowed.probes).toBeGreaterThanOrEqual(0)
    expect(result.budget!.used.probes).toBeGreaterThanOrEqual(0)
  })
})
