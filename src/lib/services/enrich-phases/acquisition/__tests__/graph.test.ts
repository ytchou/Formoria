import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'

import {
  runAcquisition,
  ACQUISITION_RECURSION_LIMIT,
  type AcquisitionDeps,
  type AcquisitionInput,
} from '../graph'
import { RESERVED_TAIL_MS } from '../budget'

// The prompt nodes call `fetchLangfusePrompt`, which returns its fallback when
// no Langfuse client can be built. Blanking the credentials keeps that true even
// if the shell that runs the suite happens to export them.
beforeAll(() => {
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
  vi.stubEnv('LANGFUSE_SECRET_KEY', '')
  vi.stubEnv('LANGFUSE_HOST', '')
})

// ---------------------------------------------------------------------------
// Fakes — no `vi.mock` of `@/lib/services/…` (check-test-boundaries.mjs) and no
// mocked model class: the graph takes its model through `options.model`.
// ---------------------------------------------------------------------------

type ScriptedToolCall = { name: string; args: Record<string, unknown> }
/** One scripted model turn: tool calls, a JSON payload, or raw text. */
type ScriptedTurn = ScriptedToolCall[] | Record<string, unknown> | string

/**
 * A tool-calling fake. Routes on the system prompt so a test scripts the plan
 * turns and the critique verdicts independently — the graph calls one model for
 * both and the ordering between them depends on the path taken.
 */
function fakeAgentModel(script: { plan?: ScriptedTurn[]; critique?: Array<Record<string, unknown>> }) {
  let planIndex = 0
  let critiqueIndex = 0
  let callId = 0

  const invoke = vi.fn(async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
    // Check for abort before proceeding (supports critique timeout tests)
    if (options?.signal?.aborted) {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    }

    const system = String(messages[0]?.content ?? '')
    if (system.includes('CritiqueVerdict')) {
      const verdicts = script.critique ?? [{ verdict: 'sufficient', reason: 'enough data' }]
      const verdict = verdicts[critiqueIndex] ?? verdicts.at(-1)!
      critiqueIndex++
      return new AIMessage({
        content: JSON.stringify(verdict),
        usage_metadata: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })
    }

    const turns = script.plan ?? []
    const turn = turns[planIndex] ?? turns.at(-1) ?? ''
    planIndex++

    if (Array.isArray(turn)) {
      return new AIMessage({
        content: '',
        tool_calls: turn.map((call) => {
          callId += 1
          return { name: call.name, args: call.args, id: `call-${callId}`, type: 'tool_call' as const }
        }),
        usage_metadata: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      })
    }

    return new AIMessage({
      content: typeof turn === 'string' ? turn : JSON.stringify(turn),
      usage_metadata: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    })
  })

  // `bindTools` hands back a fresh object over the SAME invoke mock rather than
  // `model` itself: a self-referential literal has no inferable type, and the
  // shared mock keeps the script index and the call counts in one place.
  return { invoke, bindTools: vi.fn(() => ({ invoke })) }
}

/** A model with no `bindTools` — exercises the single-call plan fallback. */
function fallbackOnlyModel(script: { plan?: ScriptedTurn[]; critique?: Array<Record<string, unknown>> }) {
  const { invoke } = fakeAgentModel(script)
  return { invoke }
}

const RICH_BODY = 'Taiwanese ceramics studio. '.repeat(20)
const richHtml = (title = 'Test Brand Official') =>
  `<html><head><title>${title}</title></head><body>${RICH_BODY}</body></html>`

function makeDeps(overrides: Partial<AcquisitionDeps> = {}): AcquisitionDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: richHtml(), status: 200, latencyMs: 50, error: null }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({
        html: richHtml('Rendered Brand'),
        finalUrl: 'https://example.com',
        status: 200,
      }),
    },
    scrapeBrandUrls: vi.fn().mockResolvedValue({
      data: { name: 'Test Brand', description: 'A test brand' },
      statuses: [
        {
          url: 'https://example.com',
          ok: true,
          classification: 'official-site',
          httpStatus: 200,
          latencyMs: 100,
          error: null,
        },
      ],
    }),
    ...overrides,
  }
}

const VALID_PLAN = {
  surfaces: [
    { url: 'https://example.com', fetch: 'static', strategy: 'official-site', reason: 'main site' },
  ],
  fanOut: [],
  catalog: { entryUrls: [], priorityProductUrls: [] },
  socialBios: {},
  decisions: [{ step: 'plan', action: 'chose static', reason: 'main site', ms: 10 }],
}

const SUFFICIENT = { verdict: 'sufficient', reason: 'enough data' }

const baseInput: AcquisitionInput = {
  brand: { id: 'brand-1', slug: 'test-brand', name: 'Test Brand' },
  knownUrls: ['https://example.com'],
  jobId: 'job-1',
}

function scrapeWithImages(urls: string[], pageUrl = 'https://example.com') {
  return {
    data: {
      name: 'Test Brand',
      description: 'A test brand',
      galleryImageUrls: urls,
      imageSources: urls.map((url, position) => ({ url, method: 'crawl', pageUrl, position })),
      jsonLdImageUrls: [],
    },
    statuses: [
      {
        url: pageUrl,
        ok: true,
        classification: 'official-site',
        httpStatus: 200,
        latencyMs: 100,
        error: null,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Graph shape
// ---------------------------------------------------------------------------

describe('acquisition graph — LangGraph shape', () => {
  it('graph_scripted_model_produces_plan_execute_critique_finalize', async () => {
    const model = fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    expect(result.plan).toBeDefined()
    expect(result.directives).toBeDefined()
    expect(result.scrapeResult).toBeDefined()
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(1)
    expect(model.bindTools).toHaveBeenCalled()
    // Every node leaves a trace entry with its own elapsed time.
    expect(result.decisions.map((d) => d.step)).toEqual(
      expect.arrayContaining(['gather', 'plan', 'execute', 'critique', 'finalize']),
    )
    for (const decision of result.decisions) expect(typeof decision.ms).toBe('number')
  })

  it('acquisition_graph_is_a_stategraph_with_recursion_limit', async () => {
    expect(ACQUISITION_RECURSION_LIMIT).toBe(12)

    // A model that only ever probes and never submits must terminate.
    const model = fakeAgentModel({
      plan: [[{ name: 'probe_static', args: { url: 'https://example.com' } }]],
    })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('fallback')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
    expect(
      result.decisions.some((d) => `${d.action} ${d.reason}`.includes('recursion_limit')),
    ).toBe(true)
  })

  it('signal_abort_stops_graph', async () => {
    const controller = new AbortController()
    controller.abort()

    const model = fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model, signal: controller.signal })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toBe('aborted')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('run_recovers_last_state_on_recursion_error', async () => {
    // A model that only probes and never submits — hits the inner recursion
    // limit and falls to the single-call fallback. The plan fails, but the
    // graph must still return a result with budget and decision trace intact.
    const model = fakeAgentModel({
      plan: [[{ name: 'probe_static', args: { url: 'https://example.com' } }]],
    })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('fallback')
    // The plan loop recorded the recursion_limit decision
    expect(
      result.decisions.some((d) => `${d.action} ${d.reason}`.includes('recursion_limit')),
    ).toBe(true)
    // Budget and decisions should be intact
    expect(result.budget).toBeDefined()
    expect(result.decisions.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Plan node — bounded tool loop
// ---------------------------------------------------------------------------

describe('acquisition graph — plan tool loop', () => {
  it('plan_tool_loop_probes_then_submits', async () => {
    const model = fakeAgentModel({
      plan: [
        [{ name: 'probe_static', args: { url: 'https://example.com' } }],
        [{ name: 'probe_static', args: { url: 'https://evil.example' } }],
        [{ name: 'submit_plan', args: VALID_PLAN }],
      ],
    })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    expect(result.plan?.surfaces).toHaveLength(1)

    // The allowlisted probe ran; the unknown host never reached the fetcher.
    const fetched = vi.mocked(deps.fetchHtml).mock.calls.map(([url]) => url)
    expect(fetched).toContain('https://example.com')
    expect(fetched).not.toContain('https://evil.example')

    // gather probe (1) + one allowlisted tool probe (1). The refused probe costs
    // nothing, and executing the plan spends no probe at all — see
    // `execute_does_not_spend_probes`.
    expect(result.budget!.used.probes).toBe(2)
    expect(result.budget!.used.probes).toBeLessThanOrEqual(result.budget!.allowed.probes)
  })

  it('plan_loop_falls_back_to_single_call_after_two_bad_submits', async () => {
    const badPlan = { surfaces: 'not-an-array' }
    const model = fakeAgentModel({
      plan: [
        [{ name: 'submit_plan', args: badPlan }],
        [{ name: 'submit_plan', args: badPlan }],
        // The loop gives up; the single json-mode call still returns a good plan.
        VALID_PLAN,
      ],
    })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    expect(result.plan).toBeDefined()
    expect(result.decisions.some((d) => d.action === 'plan_fallback')).toBe(true)
  })

  it('plan_loop_fallback_that_also_fails_is_agent_fallback', async () => {
    const badPlan = { surfaces: 'not-an-array' }
    const model = fakeAgentModel({
      plan: [
        [{ name: 'submit_plan', args: badPlan }],
        [{ name: 'submit_plan', args: badPlan }],
        { notAValidField: true },
      ],
    })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('fallback')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('plan_falls_back_to_a_single_call_when_the_model_cannot_bind_tools', async () => {
    const model = fallbackOnlyModel({ plan: [VALID_PLAN] })
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('planned')
    expect(result.plan).toBeDefined()
  })

  it('graph_budget_exhausted_before_plan_is_fallback', async () => {
    const deps = makeDeps()
    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] }),
      budgetOverride: { probes: 0, renders: 0, search: 0, turns: 0, wallClockMs: 0 },
    })

    expect(result.agentOutcome).toBe('fallback')
    expect(deps.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('budget_allowance_and_usage_are_recorded', async () => {
    const model = fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] })
    const result = await runAcquisition(baseInput, makeDeps(), { model })

    expect(result.budget).toBeDefined()
    expect(result.budget!.allowed.probes).toBeGreaterThan(0)
    expect(result.budget!.used.turns).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Budget enforcement through the graph
// ---------------------------------------------------------------------------

describe('acquisition graph — budget is asserted, not just counted', () => {
  it('budget_probes_renders_search_are_asserted', async () => {
    // probes: the tool refuses once the allowance is spent.
    const probeModel = fakeAgentModel({
      plan: [
        [{ name: 'probe_static', args: { url: 'https://example.com' } }],
        [{ name: 'probe_static', args: { url: 'https://example.com' } }],
        [{ name: 'probe_static', args: { url: 'https://example.com' } }],
        [{ name: 'submit_plan', args: VALID_PLAN }],
      ],
    })
    const probeDeps = makeDeps()
    const probeResult = await runAcquisition(baseInput, probeDeps, {
      model: probeModel,
      budgetOverride: { probes: 2, renders: 0, search: 0, turns: 4, wallClockMs: 45_000 },
    })
    // gather spent one probe, so exactly one tool probe fits inside the cap.
    expect(vi.mocked(probeDeps.fetchHtml)).toHaveBeenCalledTimes(2)
    expect(probeResult.budget!.used.probes).toBeLessThanOrEqual(2)

    // renders: the render provider is never called past the allowance.
    const renderModel = fakeAgentModel({
      plan: [
        [{ name: 'probe_rendered', args: { url: 'https://example.com' } }],
        [{ name: 'probe_rendered', args: { url: 'https://example.com' } }],
        [{ name: 'submit_plan', args: VALID_PLAN }],
      ],
    })
    const renderDeps = makeDeps()
    await runAcquisition(baseInput, renderDeps, {
      model: renderModel,
      budgetOverride: { probes: 8, renders: 1, search: 0, turns: 4, wallClockMs: 45_000 },
    })
    expect(vi.mocked(renderDeps.renderProvider!.fetchRendered)).toHaveBeenCalledTimes(1)

    // search: a zero search allowance refuses the recovery search outright.
    const searchDeps = makeDeps({ searchBrand: vi.fn().mockResolvedValue({ urls: [], snippets: [] }) })
    const searchResult = await runAcquisition({ ...baseInput, knownUrls: [] }, searchDeps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
        critique: [{ verdict: 'thin', reason: 'nothing', recoveryAction: 'search' }, SUFFICIENT],
      }),
      budgetOverride: { probes: 8, renders: 0, search: 0, turns: 6, wallClockMs: 90_000 },
    })
    expect(searchDeps.searchBrand).not.toHaveBeenCalled()
    expect(
      searchResult.decisions.some((d) => `${d.action} ${d.reason}`.includes('search_refused')),
    ).toBe(true)
  })

  // The first staging run scraped ZERO URLs on every brand: gather had spent the
  // probe allowance, so execute "dropped" every planned surface. Scrapes are
  // bounded by `MAX_SCRAPE_URLS_PER_BRAND` inside `scrapeBrandUrls`; charging
  // them a probe as well made the plan unexecutable.
  it('execute_does_not_spend_probes', async () => {
    const twoSurfacePlan = {
      ...VALID_PLAN,
      surfaces: [
        { url: 'https://example.com', fetch: 'static', strategy: 'official-site', reason: 'main site' },
        { url: 'https://example.com/about', fetch: 'static', strategy: 'single-page', reason: 'about page' },
      ],
    }
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({ plan: [[{ name: 'submit_plan', args: twoSurfacePlan }]] }),
      // gather alone exhausts the probe allowance (one known URL, one probe).
      budgetOverride: { probes: 1, renders: 0, search: 0, turns: 3, wallClockMs: 45_000 },
    })

    expect(vi.mocked(deps.scrapeBrandUrls).mock.calls[0]![0]).toEqual([
      'https://example.com',
      'https://example.com/about',
    ])
    expect(result.budget!.used.probes).toBe(1)

    const execute = result.decisions.find((d) => d.step === 'execute')!
    expect(execute.action).toBe('scraped 2 URLs')
    expect(execute.reason).not.toContain('dropped')
  })

  // The plan STAGE is one turn, however many model calls its tool loop makes.
  // Charging the single-call fallback a second turn left `turns = 2` with
  // nothing for the critique, which then skipped as `budget_exhausted`.
  it('plan_fallback_spends_one_turn_total', async () => {
    const badPlan = { surfaces: 'not-an-array' }
    const deps = makeDeps()

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [
          [{ name: 'submit_plan', args: badPlan }],
          [{ name: 'submit_plan', args: badPlan }],
          VALID_PLAN,
        ],
        critique: [SUFFICIENT],
      }),
      budgetOverride: { probes: 8, renders: 0, search: 0, turns: 2, wallClockMs: 45_000 },
    })

    expect(result.agentOutcome).toBe('planned')
    expect(result.decisions.some((d) => d.action === 'plan_fallback')).toBe(true)
    // One turn for the whole plan stage, one for the critique.
    expect(result.budget!.used.turns).toBe(2)

    const critique = result.decisions.find((d) => d.step === 'critique')!
    expect(critique.action).toBe('sufficient')
    expect(critique.reason).not.toContain('budget')
  })
})

// ---------------------------------------------------------------------------
// Critique
// ---------------------------------------------------------------------------

describe('acquisition graph — critique', () => {
  it('critique_parses_url_verdicts_and_finalize_exposes_them', async () => {
    const model = fakeAgentModel({
      plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
      critique: [
        {
          verdict: 'sufficient',
          reason: 'ownership checked',
          urlVerdicts: [
            { url: 'https://example.com', owned: true, confidence: 'high', reason: 'first-party site' },
            { url: 'https://retailer.example', owned: false, confidence: 'high', reason: 'marketplace listing' },
          ],
        },
      ],
    })

    const result = await runAcquisition(baseInput, makeDeps(), { model })

    expect(result.urlVerdicts).toHaveLength(2)
    expect(result.urlVerdicts![1]).toMatchObject({
      url: 'https://retailer.example',
      owned: false,
      confidence: 'high',
    })
  })

  it('graph_thin_verdict_runs_recovery_exactly_once', async () => {
    const planWithFanOut = { ...VALID_PLAN, fanOut: ['https://extra.example/about'] }
    const deps = makeDeps()
    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: planWithFanOut }]],
        critique: [{ verdict: 'thin', reason: 'not enough', recoveryAction: 'fanout' }, SUFFICIENT],
      }),
    })

    expect(result.agentOutcome).toBe('recovered')
    expect(deps.scrapeBrandUrls).toHaveBeenCalledTimes(2)

    // A second thin verdict does not loop again.
    const deps2 = makeDeps()
    const result2 = await runAcquisition(baseInput, deps2, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: planWithFanOut }]],
        critique: [{ verdict: 'thin', reason: 'still thin', recoveryAction: 'fanout' }],
      }),
    })
    expect(result2.agentOutcome).toBe('recovered')
    expect(deps2.scrapeBrandUrls).toHaveBeenCalledTimes(2)
  })

  it('critique_fail_verdict_blocks', async () => {
    const deps = makeDeps()
    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
        critique: [{ verdict: 'fail', reason: 'brand does not exist' }],
      }),
    })

    expect(result.agentOutcome).toBe('blocked')
    expect(result.error).toContain('brand does not exist')
  })

  it('critique_timeout_is_treated_as_budget_exhausted_not_graph_throw', async () => {
    // A critique that times out should NOT throw / crash the graph.
    // Instead, it should be treated like budget_exhausted and resolve gracefully.
    const critiqueAbortModel = fakeAgentModel({
      plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
      critique: [{ verdict: 'sufficient', reason: 'enough data' }],
    })
    // Override the model's invoke to throw AbortError on critique calls
    let _critiqueCallCount = 0
    const originalInvoke = critiqueAbortModel.invoke
    critiqueAbortModel.invoke.mockImplementation(async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
      const system = String(messages[0]?.content ?? '')
      if (system.includes('CritiqueVerdict')) {
        _critiqueCallCount++
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      return originalInvoke(messages, options)
    })

    const deps = makeDeps()
    const result = await runAcquisition(baseInput, deps, { model: critiqueAbortModel })

    // The graph should resolve, not throw
    expect(result).toBeDefined()
    expect(result.agentOutcome).not.toBe('blocked')
    // The critique skipped entry should mention budget_exhausted-style
    const critiqueDecision = result.decisions.find(
      (d) => d.step === 'critique' && (d.reason.includes('budget') || d.action.includes('CRITIQUE-TIMEOUT') || d.reason.includes('timeout')),
    )
    expect(critiqueDecision).toBeDefined()
  })

  it('abort_after_images_recovers_last_state_with_image_pool', async () => {
    const classified = [
      { id: 'img-1', tag: 'product', score: 0.9, disposition: 'keep', storage_path: 'brands/brand-1/1.jpg', sourceUrl: 'https://example.com', width: 1200, height: 900 },
      { id: 'img-2', tag: 'hero', score: 0.85, disposition: 'keep', storage_path: 'brands/brand-1/2.jpg', sourceUrl: 'https://example.com', width: 1200, height: 900 },
    ]

    // The critique call will abort
    const model = fakeAgentModel({
      plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
    })
    const originalInvoke = model.invoke
    model.invoke.mockImplementation(async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
      const system = String(messages[0]?.content ?? '')
      if (system.includes('CritiqueVerdict')) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      return originalInvoke(messages, options)
    })

    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'])),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example/1.jpg']),
      classifyImages: vi.fn().mockResolvedValue(classified),
    })

    const result = await runAcquisition(baseInput, deps, { model })

    // Critique timed out but was caught — graph continued to finalize
    expect(result.agentOutcome).toBe('planned')
    // Images should be available because the images node ran successfully
    expect(result.classifiedImages!.length).toBeGreaterThan(0)
    // The image pool should be populated since finalize ran
    expect(result.imagePool).toBeDefined()
    expect(result.imagePool!.length).toBeGreaterThan(0)
    // The critique decision should show the timeout was handled
    const critiqueDecision = result.decisions.find(
      (d) => d.step === 'critique' && d.action.includes('CRITIQUE-TIMEOUT'),
    )
    expect(critiqueDecision).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

describe('acquisition graph — recovery', () => {
  it('recover_runs_search_brand_when_thin_and_no_known_urls', async () => {
    const searchBrand = vi.fn().mockResolvedValue({
      urls: ['https://found.example'],
      snippets: ['brand info'],
    })
    const deps = makeDeps({ searchBrand })

    const result = await runAcquisition({ ...baseInput, knownUrls: [] }, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: { ...VALID_PLAN, surfaces: [], fanOut: [] } }]],
        critique: [{ verdict: 'thin', reason: 'nothing found', recoveryAction: 'search' }, SUFFICIENT],
      }),
    })

    expect(searchBrand).toHaveBeenCalledTimes(1)
    expect(searchBrand).toHaveBeenCalledWith('Test Brand')
    expect(result.budget!.used.search).toBe(1)
  })

  it('recover_refuses_search_when_known_urls_are_rich', async () => {
    const searchBrand = vi.fn().mockResolvedValue({ urls: [], snippets: [] })
    const deps = makeDeps({ searchBrand })

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
        critique: [{ verdict: 'thin', reason: 'want more', recoveryAction: 'search' }, SUFFICIENT],
      }),
    })

    expect(searchBrand).not.toHaveBeenCalled()
    expect(
      result.decisions.some((d) => `${d.action} ${d.reason}`.includes('search_refused')),
    ).toBe(true)
  })

  it('recover_runs_search_images_when_keeps_thin_and_records_name_used', async () => {
    const searchImages = vi.fn().mockResolvedValue([
      'https://cdn.example/found-1.jpg',
      'https://cdn.example/found-2.jpg',
    ])
    const downloadAndStoreImages = vi.fn().mockResolvedValue(['https://storage.example/found-1.jpg'])
    const classifyImages = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'img-1', tag: 'product', score: 0.9, disposition: 'keep' }])
      .mockResolvedValue([
        { id: 'img-1', tag: 'product', score: 0.9, disposition: 'keep' },
        { id: 'img-2', tag: 'product', score: 0.7, disposition: 'keep' },
      ])

    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(['https://cdn.example/a.jpg'])),
      downloadAndStoreImages,
      classifyImages,
      searchImages,
    })

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: { ...VALID_PLAN, fanOut: ['https://extra.example'] } }]],
        critique: [{ verdict: 'thin', reason: 'few images', recoveryAction: 'fanout' }, SUFFICIENT],
      }),
    })

    expect(searchImages).toHaveBeenCalledTimes(1)
    expect(searchImages).toHaveBeenCalledWith({
      brandName: 'Test Brand Official',
      websiteHost: 'example.com',
    })
    // Decision #38: the name the image search actually used is on the record.
    const searchDecision = result.decisions.find((d) => d.action.includes('search_images'))
    expect(searchDecision).toBeDefined()
    expect(searchDecision!.reason).toContain('Test Brand Official')
  })

  it('images_recover_classifies_only_new_ids', async () => {
    const classifyImages = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'img-1', tag: 'product', score: 0.9 }])
      // The brand-scoped classifier returns the first batch again alongside the new row.
      .mockResolvedValueOnce([
        { id: 'img-1', tag: 'product', score: 0.9 },
        { id: 'img-2', tag: 'hero', score: 0.8 },
      ])

    let scrapeCall = 0
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockImplementation(async () => {
        scrapeCall += 1
        return scrapeCall === 1
          ? scrapeWithImages(['https://cdn.example/a.jpg'])
          : scrapeWithImages(['https://cdn.example/b.jpg'], 'https://extra.example')
      }),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example/a.jpg']),
      classifyImages,
    })

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: { ...VALID_PLAN, fanOut: ['https://extra.example'] } }]],
        critique: [{ verdict: 'thin', reason: 'need more', recoveryAction: 'fanout' }, SUFFICIENT],
      }),
    })

    expect(result.agentOutcome).toBe('recovered')
    const ids = result.classifiedImages!.map((image) => image.id)
    expect(ids).toEqual(['img-1', 'img-2'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe('acquisition graph — images node', () => {
  const planOnly = { plan: [[{ name: 'submit_plan', args: VALID_PLAN }] as ScriptedToolCall[]] }

  it('images_node_classifies_scraped_images', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi
        .fn()
        .mockResolvedValue(scrapeWithImages(['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'])),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example/1.jpg']),
      classifyImages: vi.fn().mockResolvedValue([
        { id: 'img-1', tag: 'product', score: 0.9, storage_path: 'brands/brand-1/1.jpg' },
        { id: 'img-2', tag: 'hero', score: 0.85, storage_path: 'brands/brand-1/2.jpg' },
      ]),
    })

    const result = await runAcquisition(baseInput, deps, { model: fakeAgentModel(planOnly) })

    expect(result.classifiedImages).toHaveLength(2)
    expect(deps.downloadAndStoreImages).toHaveBeenCalledTimes(1)
    expect(deps.classifyImages).toHaveBeenCalledTimes(1)
  })

  it('images_node_skips_when_dry_run', async () => {
    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(['https://cdn.example/1.jpg'])),
      downloadAndStoreImages: vi.fn().mockResolvedValue([]),
      classifyImages: vi.fn().mockResolvedValue([]),
    })

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel(planOnly),
      dryRun: true,
    })

    expect(result.agentOutcome).toBe('planned')
    expect(deps.classifyImages).not.toHaveBeenCalled()
  })

  it('images_node_empty_when_no_images', async () => {
    const deps = makeDeps({
      downloadAndStoreImages: vi.fn(),
      classifyImages: vi.fn(),
    })

    const result = await runAcquisition(baseInput, deps, { model: fakeAgentModel(planOnly) })

    expect(result.classifiedImages).toEqual([])
    expect(deps.downloadAndStoreImages).not.toHaveBeenCalled()
    expect(deps.classifyImages).not.toHaveBeenCalled()
  })

  it('images_node_extends_budget_per_stored_batch_under_ceiling', async () => {
    // 15 images stored → ceil(15/10) = 2 batches → 2 × IMAGE_BATCH_EXTENSION_MS extension
    const imageUrls = Array.from({ length: 15 }, (_, i) => `https://cdn.example/${i}.jpg`)
    const classified = imageUrls.map((_, i) => ({
      id: `img-${i}`,
      tag: 'product' as const,
      score: 0.9,
      disposition: 'keep' as const,
      storage_path: `brands/brand-1/${i}.jpg`,
    }))

    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(imageUrls)),
      downloadAndStoreImages: vi.fn().mockResolvedValue(
        imageUrls.map((_, i) => `https://storage.example/${i}.jpg`),
      ),
      classifyImages: vi.fn().mockResolvedValue(classified),
    })

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
      }),
    })

    // The budget should have been extended (exact value depends on timing, but
    // it should be higher than the base budget for a static 1-probe site)
    expect(result.budget!.allowed.wallClockMs).toBeGreaterThan(61_500)
    // But never above the ceiling
    expect(result.budget!.allowed.wallClockMs).toBeLessThanOrEqual(180_000)
  })
})

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

describe('acquisition graph — finalize', () => {
  const planOnly = { plan: [[{ name: 'submit_plan', args: VALID_PLAN }] as ScriptedToolCall[]] }

  it('finalize_picks_hero_and_next_nine_gallery_from_rank', async () => {
    const classified = Array.from({ length: 12 }, (_, index) => ({
      id: `img-${index}`,
      tag: 'product' as const,
      score: 1 - index * 0.05,
      disposition: 'keep' as const,
      storage_path: `brands/brand-1/${index}.jpg`,
      sourceUrl: 'https://example.com',
      width: 1200,
      height: 900,
    }))

    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(['https://cdn.example/1.jpg'])),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example/1.jpg']),
      classifyImages: vi.fn().mockResolvedValue(classified),
    })

    const result = await runAcquisition(baseInput, deps, { model: fakeAgentModel(planOnly) })

    expect(result.hero).toBeDefined()
    expect(result.hero!.id).toBe('img-0')
    // The next nine, in rank order — no per-page or logo cap.
    expect(result.gallery).toHaveLength(9)
    expect(result.gallery!.map((image) => image.id)).toEqual([
      'img-1', 'img-2', 'img-3', 'img-4', 'img-5', 'img-6', 'img-7', 'img-8', 'img-9',
    ])
    expect(result.imagePool![0]).toMatchObject({
      id: 'img-0',
      tag: 'product',
      score: expect.any(Number),
      disposition: 'keep',
      sourceUrl: 'https://example.com',
    })
    // Pages that yielded images are reported for the products agent.
    expect(result.acquisitionPageUrls).toContain('https://example.com')
  })

  it('finalize_discovers_catalog', async () => {
    const catalogResult = { triples: [], attempts: [], evidence: new Map() }
    const discoverCatalog = vi.fn().mockResolvedValue(catalogResult)
    const catalogSources = [{ url: 'https://example.com', channel: 'official' as const }]
    const deps = makeDeps({ discoverCatalog, catalogSources })

    const planWithCatalog = {
      ...VALID_PLAN,
      catalog: {
        entryUrls: ['https://example.com/products'],
        priorityProductUrls: ['https://example.com/products/item-1'],
      },
    }

    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({ plan: [[{ name: 'submit_plan', args: planWithCatalog }]] }),
    })

    expect(result.catalogResult).toBeDefined()
    expect(discoverCatalog).toHaveBeenCalledTimes(1)
    expect(discoverCatalog.mock.calls[0]![0]).toMatchObject({
      sources: catalogSources,
      entryUrls: ['https://example.com/products'],
      priorityProductUrls: ['https://example.com/products/item-1'],
    })
  })

  // The brand's own purchase channels ARE the catalog sources. A plan that
  // listed no product URL used to skip discovery outright, so the products
  // phase then reported "no product candidates in the merged pool".
  it('finalize_discovers_catalog_from_sources_when_plan_lists_none', async () => {
    const discoverCatalog = vi
      .fn()
      .mockResolvedValue({ triples: [], attempts: [], evidence: new Map() })
    const catalogSources = [{ url: 'https://example.com', channel: 'official' as const }]
    const deps = makeDeps({ discoverCatalog, catalogSources })

    const result = await runAcquisition(baseInput, deps, {
      // VALID_PLAN carries an empty catalog: no entryUrls, no priorityProductUrls.
      model: fakeAgentModel(planOnly),
    })

    expect(discoverCatalog).toHaveBeenCalledTimes(1)
    expect(discoverCatalog.mock.calls[0]![0]).toMatchObject({
      sources: catalogSources,
      entryUrls: [],
      priorityProductUrls: [],
    })
    expect(result.catalogResult).toBeDefined()
    expect(result.decisions.find((d) => d.step === 'finalize')!.reason).toContain(
      'catalog discovered',
    )
  })

  it('finalize_records_no_sources_when_nothing_to_discover_from', async () => {
    const discoverCatalog = vi.fn()
    const deps = makeDeps({ discoverCatalog, catalogSources: [] })

    const result = await runAcquisition(baseInput, deps, { model: fakeAgentModel(planOnly) })

    expect(discoverCatalog).not.toHaveBeenCalled()
    expect(result.decisions.find((d) => d.step === 'finalize')!.reason).toContain(
      'catalog skipped: no sources',
    )
  })

  it('finalize_collects_name_candidates_from_fetched_pages', async () => {
    const result = await runAcquisition(baseInput, makeDeps(), {
      model: fakeAgentModel(planOnly),
    })

    expect(result.nameCandidates).toContain('Test Brand Official')
  })

  it('finalize_sets_provider_failure_only_when_provider_threw_and_evidence_empty', async () => {
    const failedScrape = {
      data: {},
      statuses: [
        {
          url: 'https://example.com',
          ok: false,
          classification: 'official-site' as const,
          httpStatus: 503,
          latencyMs: 10,
          error: 'render failed',
        },
      ],
    }
    const brokenRender = {
      fetchRendered: vi.fn().mockRejectedValue(new Error('browserless 429')),
    }

    const failing = makeDeps({ renderProvider: brokenRender, scrapeBrandUrls: vi.fn().mockResolvedValue(failedScrape) })
    const failingResult = await runAcquisition(baseInput, failing, {
      model: fakeAgentModel({
        plan: [
          [{ name: 'probe_rendered', args: { url: 'https://example.com' } }],
          [{ name: 'submit_plan', args: VALID_PLAN }],
        ],
      }),
      budgetOverride: { probes: 8, renders: 2, search: 0, turns: 4, wallClockMs: 45_000 },
    })
    expect(failingResult.providerFailure).toBe(true)

    // Same provider throw, but the scrape produced evidence → not a provider failure.
    const recovered = makeDeps({ renderProvider: { fetchRendered: vi.fn().mockRejectedValue(new Error('browserless 429')) } })
    const recoveredResult = await runAcquisition(baseInput, recovered, {
      model: fakeAgentModel({
        plan: [
          [{ name: 'probe_rendered', args: { url: 'https://example.com' } }],
          [{ name: 'submit_plan', args: VALID_PLAN }],
        ],
      }),
      budgetOverride: { probes: 8, renders: 2, search: 0, turns: 4, wallClockMs: 45_000 },
    })
    expect(recoveredResult.providerFailure).toBe(false)
  })

  it('finalize_runs_on_own_signal_when_budget_spent', async () => {
    // Even when wall clock is exhausted before finalize starts, finalize must
    // still run and produce ranked images + catalog result.
    const classified = Array.from({ length: 3 }, (_, index) => ({
      id: `img-${index}`,
      tag: 'product' as const,
      score: 1 - index * 0.05,
      disposition: 'keep' as const,
      storage_path: `brands/brand-1/${index}.jpg`,
      sourceUrl: 'https://example.com',
      width: 1200,
      height: 900,
    }))

    const catalogResult = { triples: [], attempts: [], evidence: new Map() }
    const discoverCatalog = vi.fn().mockResolvedValue(catalogResult)
    const catalogSources = [{ url: 'https://example.com', channel: 'official' as const }]

    const deps = makeDeps({
      scrapeBrandUrls: vi.fn().mockResolvedValue(scrapeWithImages(['https://cdn.example/1.jpg'])),
      downloadAndStoreImages: vi.fn().mockResolvedValue(['https://storage.example/1.jpg']),
      classifyImages: vi.fn().mockResolvedValue(classified),
      discoverCatalog,
      catalogSources,
    })

    // Use a very short wall clock so it's exhausted by the time finalize runs
    const result = await runAcquisition(baseInput, deps, {
      model: fakeAgentModel({
        plan: [[{ name: 'submit_plan', args: VALID_PLAN }]],
      }),
      budgetOverride: { probes: 8, renders: 0, search: 0, turns: 6, wallClockMs: 1 },
    })

    // Finalize should still have run and ranked images
    const finalizeDecision = result.decisions.find((d) => d.step === 'finalize')
    expect(finalizeDecision).toBeDefined()
    expect(finalizeDecision!.action).toContain('ranked images')
    // Catalog should have been discovered
    expect(result.catalogResult).toBeDefined()
    expect(discoverCatalog).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Trace / decision shape
// ---------------------------------------------------------------------------

describe('acquisition graph — trace entries', () => {
  it('trace_entries_carry_started_at_allowance_remaining', async () => {
    const model = fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] })
    const result = await runAcquisition(baseInput, makeDeps(), { model })

    // Every decision entry must have the extended trace fields
    for (const decision of result.decisions) {
      expect(typeof decision.ms).toBe('number')
      expect(typeof (decision as Record<string, unknown>).startedAtMs).toBe('number')
      expect(typeof (decision as Record<string, unknown>).allowanceMs).toBe('number')
      expect(typeof (decision as Record<string, unknown>).remainingMs).toBe('number')
      expect((decision as Record<string, unknown>).startedAtMs).toBeGreaterThanOrEqual(0)
      expect((decision as Record<string, unknown>).allowanceMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('node_deadline_never_consumes_reserved_tail', async () => {
    // Use a tight wall clock to test that node allowances respect the reserved tail
    const model = fakeAgentModel({ plan: [[{ name: 'submit_plan', args: VALID_PLAN }]] })
    const result = await runAcquisition(baseInput, makeDeps(), {
      model,
      // With a real budget, verify that non-critique/finalize decisions have allowances
      // that leave room for the reserved tail
    })

    const nonTailDecisions = result.decisions.filter(
      (d) => !['critique', 'finalize', 'graph'].includes(d.step),
    )
    for (const decision of nonTailDecisions) {
      const allowance = (decision as Record<string, unknown>).allowanceMs as number
      const remaining = (decision as Record<string, unknown>).remainingMs as number
      // The node's allowance should be ≤ remaining − RESERVED_TAIL_MS
      // (but only when remaining > RESERVED_TAIL_MS — if budget is already consumed, anything goes)
      if (remaining > RESERVED_TAIL_MS && allowance > 0) {
        expect(allowance).toBeLessThanOrEqual(remaining - RESERVED_TAIL_MS)
      }
    }

    // Critique/finalize allowance should be ≤ RESERVED_TAIL_MS
    const tailDecisions = result.decisions.filter(
      (d) => d.step === 'critique' || d.step === 'finalize',
    )
    for (const decision of tailDecisions) {
      const allowance = (decision as Record<string, unknown>).allowanceMs as number
      expect(allowance).toBeLessThanOrEqual(RESERVED_TAIL_MS)
    }
  })
})
