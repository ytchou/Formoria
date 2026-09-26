import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CompiledStateGraph } from '@langchain/langgraph'

import type { ChatMessage } from '@/lib/services/openai-client'

import {
  buildProductsGraph,
  createProductsRunContext,
  runProductsAgent,
  selectCandidates,
  PRODUCTS_RECURSION_LIMIT,
  type ProductsDeps,
  type ProductsInput,
} from '../graph'
import { PRODUCTS_BUDGET_CEILINGS } from '../budget'
import { PRODUCTS_SCHEMA } from '../../products'

// Wrap `fetchLangfusePromptWithMeta` so tests can inspect the variables dict
// passed by graph nodes. The boundary checker forbids mocking `@/lib/services/`
// and `@/lib/supabase/` — `@/lib/langfuse/` is allowed.
const promptWithMetaCalls: Array<[string, Record<string, string> | undefined]> = []
vi.mock('@/lib/langfuse/prompt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/langfuse/prompt')>()
  return {
    ...actual,
    fetchLangfusePromptWithMeta: vi.fn(
      async (name: string, variables?: Record<string, string>) => {
        promptWithMetaCalls.push([name, variables])
        return actual.fetchLangfusePromptWithMeta(name as import('@/lib/langfuse/prompt').PromptName, variables)
      },
    ),
    fetchLangfusePrompt: vi.fn(
      async (name: string, variables?: Record<string, string>) => {
        return actual.fetchLangfusePrompt(name as import('@/lib/langfuse/prompt').PromptName, variables)
      },
    ),
  }
})

// The prompt nodes call `fetchLangfusePrompt`, which returns its fallback when
// no Langfuse client can be built. Blanking the credentials keeps that true even
// if the shell that runs the suite happens to export them.
beforeAll(() => {
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', '')
  vi.stubEnv('LANGFUSE_SECRET_KEY', '')
  vi.stubEnv('LANGFUSE_HOST', '')
})

// ---------------------------------------------------------------------------
// Fakes — no `vi.mock` of `@/lib/services/…` (check-test-boundaries.mjs). The
// model arrives through `options.model`, everything else through `deps`.
// ---------------------------------------------------------------------------

/**
 * A plain-object chat model, the shape `AgentModel` declares: plain `ChatMessage`
 * objects in, `{ content, usage }` out. No provider SDK message class is
 * involved on either side (DEV-1700).
 */
type ScriptedResponse =
  | string
  | { content: string | null; refusal?: string; finishReason?: string }

function scriptedModel(responses: ScriptedResponse[]) {
  let index = 0
  const invoke = vi.fn(
    async (
      _messages: ChatMessage[],
      _options?: {
        signal?: AbortSignal
        schema?: { name: string; schema: Record<string, unknown> }
      },
    ) => {
      const scripted = responses[index++] ?? responses.at(-1) ?? '{}'
      const reply = typeof scripted === 'string' ? { content: scripted } : scripted
      return {
        ...reply,
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }
    },
  )
  return { invoke }
}

/** A propose reply whose first description echoes the name: repairable. */
function nameEchoProposalResponse(): string {
  return validProposalResponse({
    products: [
      productFor(URL_A, 'Test Product A', {
        product_description_zh: 'Test Product A 是一個很棒的產品',
      }),
      productFor(URL_B, 'Test Product B'),
    ],
  })
}

const PAGE_HTML = (extra = '') =>
  `<html><head><title>Product page</title>${extra}</head><body><main><p>A ceramic plate made in Taiwan. All materials from Taiwan. Diameter 21cm.</p></main></body></html>`

/** A JS shell: body text under the 20-character floor plus a script tag. */
const SHELL_HTML = `<html><head><title>Loading</title></head><body><div id="root"></div><script>x</script></body></html>`

function evaluationFor(url: string) {
  return {
    candidate_url: url,
    editorial_score: 85,
    editorial_rationale: 'single identifiable product with durable facts',
    made_in_taiwan: false,
    materials_from_taiwan: false,
    origin_excerpt_ids: [],
    product_model: null,
  }
}

function productFor(url: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    name_zh: name,
    name_en: name,
    category: 'fashion',
    subcategory: null,
    material: [],
    official_url: url,
    image_source_url: null,
    // Names Taiwan: the default page states "made in Taiwan", so a description
    // without it would trip the soft origin repair (DEV-1856) in every test.
    product_description_zh: '這是一個台灣製造的測試產品描述，用來驗證提案流程。',
    sources: [{ url, source_type: 'official', claim_zh: null }],
    ...overrides,
  }
}

const URL_A = 'https://brand.com/product-a'
const URL_B = 'https://brand.com/product-b'
const URL_C = 'https://brand.com/product-c'

function validProposalResponse(
  overrides: { products?: unknown[]; evaluations?: unknown[] } = {},
): string {
  return JSON.stringify({
    evaluations: overrides.evaluations ?? [URL_A, URL_B, URL_C].map(evaluationFor),
    products: overrides.products ?? [
      productFor(URL_A, 'Test Product A'),
      productFor(URL_B, 'Test Product B'),
    ],
  })
}

function makeDeps(overrides: Partial<ProductsDeps> = {}): ProductsDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: PAGE_HTML(), statusCode: 200 }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({
        html: PAGE_HTML(),
        finalUrl: 'https://brand.com',
        status: 200,
      }),
    },
    ...overrides,
  }
}

/** Minimal RankableImage that satisfies rankForProduct's sourceUrl match. */
function fakeImage(sourceUrl: string, imageUrl?: string) {
  return {
    id: `img-${sourceUrl}`,
    tag: 'product' as const,
    score: 80,
    sourceUrl,
    ...(imageUrl ? { imageUrl } : {}),
  }
}

const baseInput: ProductsInput = {
  brand: { id: 'brand-1', slug: 'test-brand', name: 'Test Brand', url: 'https://brand.com' },
  pool: [
    { url: URL_A, normalizedUrl: URL_A, title: 'Product A', supplier: 'catalog', urlClass: 'product-detail' as const },
    { url: URL_B, normalizedUrl: URL_B, title: 'Product B', supplier: 'catalog', urlClass: 'product-detail' as const },
    { url: URL_C, normalizedUrl: URL_C, title: 'Product C', supplier: 'catalog', urlClass: 'product-detail' as const },
  ],
  imagePool: [fakeImage(URL_A), fakeImage(URL_B), fakeImage(URL_C)],
  scrapedData: { description: 'Test brand products' },
}

// ---------------------------------------------------------------------------
// Graph shape
// ---------------------------------------------------------------------------

describe('products agent graph', () => {
  it('products_graph_is_a_stategraph_with_conditional_repair_edge', () => {
    expect(PRODUCTS_RECURSION_LIMIT).toBe(12)

    const compiled = buildProductsGraph(
      createProductsRunContext(baseInput, makeDeps(), {}),
    )
    expect(compiled).toBeInstanceOf(CompiledStateGraph)

    const drawn = compiled.getGraph()
    expect(Object.keys(drawn.nodes)).toEqual(
      expect.arrayContaining(['select', 'read', 'propose', 'verify', 'repair', 'finalize']),
    )

    // Repair is reached ONLY through a conditional edge. An unconditional edge
    // into it would spend a model turn on every run, repairable or not.
    const intoRepair = drawn.edges.filter((edge) => edge.target === 'repair')
    expect(intoRepair.length).toBeGreaterThan(0)
    for (const edge of intoRepair) expect(edge.conditional).toBe(true)
    expect(intoRepair.some((edge) => edge.source === 'verify')).toBe(true)

    // And repair rejoins the single exit rather than looping.
    expect(
      drawn.edges.some((edge) => edge.source === 'repair' && edge.target === 'finalize'),
    ).toBe(true)
  })

  it('graph_full_happy_path', async () => {
    const model = scriptedModel([validProposalResponse()])
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('proposed')
    expect(result.proposals.length).toBeGreaterThanOrEqual(1)
    expect(result.verification.proposed).toBeGreaterThan(0)
    expect(result.verification.read).toBe(3)
    expect(result.decisions.map((d) => d.step)).toEqual(
      expect.arrayContaining(['select', 'read', 'propose', 'verify', 'finalize']),
    )
    for (const decision of result.decisions) expect(typeof decision.ms).toBe('number')
    // One propose turn only: no repair was needed.
    expect(model.invoke).toHaveBeenCalledTimes(1)
  })

  // DEV-1700. The propose turn is two plain wire messages and an options object,
  // not `SystemMessage`/`HumanMessage` instances: nothing in this graph may
  // depend on a provider SDK's message classes any more.
  it('propose_sends_system_and_user_as_plain_messages', async () => {
    const model = scriptedModel([validProposalResponse()])

    await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(1)
    const [messages, options] = model.invoke.mock.calls[0]!
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'system', content: expect.any(String) })
    expect(messages[1]).toEqual({ role: 'user', content: expect.any(String) })
    for (const message of messages) {
      expect(Object.getPrototypeOf(message)).toBe(Object.prototype)
    }

    // The wall-clock deadline reaches the provider, so an abort cancels the
    // in-flight request rather than only the node that follows it.
    expect(options?.signal).toBeInstanceOf(AbortSignal)

    // DEV-1864: the reply shape is a strict json_schema on the request, not
    // prose appended to the system prompt.
    // One contract: the propose turn sends the same precomputed schema as the
    // legacy products call, not a second copy built per turn.
    expect(options?.schema).toBe(PRODUCTS_SCHEMA)
    expect(String(messages[0]!.content)).not.toContain('JSON Schema\n```json')
    expect(String(messages[0]!.content)).not.toContain('Do not wrap in markdown fences')

    // The user turn carries the evidence the model is asked to propose from.
    const user = JSON.parse(String(messages[1]!.content)) as {
      brand?: { slug?: string }
      evidence?: unknown[]
    }
    expect(user.brand?.slug).toBe('test-brand')
    expect(user.evidence?.length).toBeGreaterThan(0)
  })

  // The repair turn is not a second model: `invokeModel` is the one seam every
  // turn goes through, and it always reaches `options.model`. Asserted on the
  // run context because a repairable verdict (closed-set) cannot be reached
  // through the graph — validation normalizes those fields before verify sees
  // them — so the graph itself can never spend a repair turn in a unit test.
  it('repair_turn_reuses_the_same_model', async () => {
    const model = scriptedModel(['{"products":[]}', '{"products":[]}'])
    const ctx = createProductsRunContext(baseInput, makeDeps(), { model })

    const first = await ctx.invokeModel([
      { role: 'system', content: 'propose' },
      { role: 'user', content: '{}' },
    ])
    const second = await ctx.invokeModel([
      { role: 'system', content: 'repair' },
      { role: 'user', content: '{}' },
    ])

    expect(model.invoke).toHaveBeenCalledTimes(2)
    expect(first.content).toBe('{"products":[]}')
    expect(second.content).toBe('{"products":[]}')
    expect(second.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    })
    expect(model.invoke.mock.calls[1]![0][0]).toEqual({
      role: 'system',
      content: 'repair',
    })
  })

  it('graph_read_node_renders_a_js_shell_within_budget', async () => {
    const fetchHtml = vi.fn(async (url: string) =>
      url === URL_A
        ? { text: SHELL_HTML, statusCode: 200 }
        : { text: PAGE_HTML(), statusCode: 200 },
    )
    const fetchRendered = vi
      .fn()
      .mockResolvedValue({ html: PAGE_HTML(), finalUrl: URL_A, status: 200 })
    const deps = makeDeps({ fetchHtml, renderProvider: { fetchRendered } })

    const result = await runProductsAgent(baseInput, deps, {
      model: scriptedModel([validProposalResponse()]),
    })

    // Exactly the shell page was rendered, and the ledger says so.
    expect(fetchRendered).toHaveBeenCalledTimes(1)
    expect(fetchRendered).toHaveBeenCalledWith(URL_A)
    expect(result.verification.rendered).toBe(1)
    expect(result.budget.used.renders).toBe(1)
    expect(result.budget.allowed.renders).toBeLessThanOrEqual(
      PRODUCTS_BUDGET_CEILINGS.renders,
    )
  })

  it('graph_propose_parse_failure_retries_once', async () => {
    const model = scriptedModel(['not valid json {{{{', validProposalResponse()])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(result.proposals.length).toBeGreaterThanOrEqual(1)
    expect(
      result.decisions.some((d) => d.step === 'propose' && d.action === 'parse_failed'),
    ).toBe(true)
    expect(model.invoke).toHaveBeenCalledTimes(2)
  })

  // DEV-1866: a refusal or a truncated reply cannot be fixed by asking again
  // with the same input, so neither may spend the reparse turn.
  it('propose_refusal_falls_back_without_reparse', async () => {
    const model = scriptedModel([{ content: null, refusal: 'I cannot' }, validProposalResponse()])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toBe('model_refused')
    expect(model.invoke).toHaveBeenCalledTimes(1)
    const refused = result.decisions.find((d) => d.step === 'propose' && d.action === 'refused')
    expect(refused?.reason).toBe('refusal=I cannot')
  })

  it('propose_length_falls_back_without_reparse', async () => {
    const truncated = validProposalResponse().slice(0, 40)
    const model = scriptedModel([
      { content: truncated, finishReason: 'length' },
      validProposalResponse(),
    ])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toBe('model_truncated')
    expect(model.invoke).toHaveBeenCalledTimes(1)
    expect(
      result.decisions.some((d) => d.step === 'propose' && d.action === 'truncated'),
    ).toBe(true)
  })

  it('propose_content_filter_falls_back_without_reparse', async () => {
    const model = scriptedModel([
      { content: '', finishReason: 'content_filter' },
      validProposalResponse(),
    ])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toBe('model_filtered')
    expect(model.invoke).toHaveBeenCalledTimes(1)
    expect(
      result.decisions.some((d) => d.step === 'propose' && d.action === 'filtered'),
    ).toBe(true)
  })

  it('propose_parse_failure_still_reparses', async () => {
    const model = scriptedModel([
      { content: 'not valid json {{{{', finishReason: 'stop' },
      validProposalResponse(),
    ])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    expect(result.error).toBeUndefined()
  })

  it('repair_turn_sends_REPAIR_SCHEMA', async () => {
    const model = scriptedModel([
      nameEchoProposalResponse(),
      JSON.stringify({
        products: [
          productFor(URL_A, 'Test Product A', {
            product_description_zh: '義大利植鞣牛皮手染鞋面與鞋墊',
          }),
        ],
      }),
    ])

    await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const schema = model.invoke.mock.calls[1]![1]?.schema
    expect(schema?.name).toBe('curated_product_repair')
    const properties = (schema?.schema as { properties?: Record<string, unknown> })
      .properties
    expect(properties).toHaveProperty('products')
    expect(properties).not.toHaveProperty('evaluations')
  })

  it('repair_refusal_drops_repairables', async () => {
    const model = scriptedModel([
      nameEchoProposalResponse(),
      { content: null, refusal: 'I cannot' },
    ])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const verify = result.decisions.find((d) => d.step === 'verify')
    const counts = /(\d+) repairable, (\d+) dropped/.exec(verify?.action ?? '')
    const repairable = Number(counts?.[1])
    const droppedAtVerify = Number(counts?.[2])
    expect(repairable).toBeGreaterThan(0)
    expect(result.verification.dropped).toBe(droppedAtVerify + repairable)
    const refused = result.decisions.find((d) => d.step === 'repair' && d.action === 'refused')
    expect(refused?.reason).toBe('refusal=I cannot')
    expect(result.proposals.some((p) => p.nameZh === 'Test Product A')).toBe(false)
  })

  it('graph_verify_drops_off_host_url', async () => {
    const inputWithDiffHost: ProductsInput = {
      ...baseInput,
      brand: { ...baseInput.brand, url: 'https://different-brand.com' },
    }

    const result = await runProductsAgent(inputWithDiffHost, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
    })

    expect(result.verification.dropped).toBeGreaterThan(0)
  })

  it('graph_verify_accepts_off_host_url_on_owned_channel', async () => {
    // DEV-1715: the same off-host proposal passes when that host is one of the
    // brand's own channels (a Pinkoi store it lists as purchase_pinkoi).
    const inputWithOwnedChannel: ProductsInput = {
      ...baseInput,
      brand: { ...baseInput.brand, url: 'https://different-brand.com', ownedHosts: ['brand.com'] },
    }

    const result = await runProductsAgent(inputWithOwnedChannel, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
    })

    expect(result.verification.dropped).toBe(0)
    expect(result.proposals.length).toBeGreaterThanOrEqual(1)
  })

  it('graph_image_mismatch_is_warning_not_repair', async () => {
    // After F6: images that match no product page are a warning, not a failure.
    // The proposal proceeds unverified — no repair turn is burned.
    const inputMismatchedImages: ProductsInput = {
      ...baseInput,
      imagePool: [fakeImage('https://brand.com/other-page')],
    }
    const model = scriptedModel([validProposalResponse()])

    const result = await runProductsAgent(inputMismatchedImages, makeDeps(), { model })

    expect(result.agentOutcome).toBe('proposed')
    expect(result.verification.imageUnverified).toBeGreaterThan(0)
    // Only ONE model call (propose) — no repair turn.
    expect(model.invoke).toHaveBeenCalledTimes(1)
  })

  it('graph_budget_exhausted_at_read_returns_fallback', async () => {
    const result = await runProductsAgent(baseInput, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
      budgetOverride: { reads: 0, renders: 0, turns: 6, wallClockMs: 120_000 },
    })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toContain('budget')
  })

  it('empty_pool_returns_blocked_not_fallback', async () => {
    const result = await runProductsAgent({ ...baseInput, pool: [] }, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
    })

    expect(result.agentOutcome).toBe('blocked')
    expect(result.error).toBe('empty_pool')
  })

  it('graph_no_model_returns_blocked', async () => {
    const result = await runProductsAgent(baseInput, makeDeps(), {})

    expect(result.agentOutcome).toBe('blocked')
    expect(result.error).toContain('no_model')
  })

  it('signal_abort_returns_fallback', async () => {
    const controller = new AbortController()
    controller.abort()
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, {
      model: scriptedModel([validProposalResponse()]),
      signal: controller.signal,
    })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toBe('aborted')
    // Nothing was fetched: the abort is checked before the graph starts.
    expect(deps.fetchHtml).not.toHaveBeenCalled()
  })

  it('graph_wall_clock_enforced', async () => {
    const result = await runProductsAgent(baseInput, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
      budgetOverride: { reads: 12, renders: 4, turns: 6, wallClockMs: 1 },
    })

    // The run stops early and still terminates through `finalize`, so the
    // decision trace an operator reads is complete rather than truncated.
    expect(result.decisions.length).toBeGreaterThan(0)
    const stepsRun = result.decisions.map((d) => d.step)
    expect(stepsRun).toContain('select')
    expect(stepsRun).toContain('finalize')
    expect(stepsRun).not.toContain('repair')
    expect(stepsRun.length).toBeLessThanOrEqual(6)
  })

  // -------------------------------------------------------------------------
  // Origin
  // -------------------------------------------------------------------------

  it('graph_records_origin_decisions_per_proposal', async () => {
    // The page text says made in Taiwan AND all materials from Taiwan, and the
    // model cites the excerpt ids it was given — the two-source consensus.
    const deps = makeDeps({
      loadOriginTexts: vi.fn(async (urls: readonly string[]) =>
        new Map(
          urls.map((url) => [
            url,
            'This plate is made in Taiwan. All materials are sourced in Taiwan.',
          ]),
        ),
      ),
    })

    // The excerpt ids are derived from the candidate ids the caller supplies,
    // so the test can predict them exactly.
    const candidateIdsByUrl = new Map([
      [URL_A, 'cand-a'],
      [URL_B, 'cand-b'],
      [URL_C, 'cand-c'],
    ])
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [
          {
            ...evaluationFor(URL_A),
            made_in_taiwan: true,
            materials_from_taiwan: true,
            origin_excerpt_ids: ['cand-a:origin:1'],
          },
          evaluationFor(URL_B),
          evaluationFor(URL_C),
        ],
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    const result = await runProductsAgent(
      { ...baseInput, candidateIdsByUrl },
      deps,
      { model },
    )

    expect(result.originDecisions.get(URL_A)?.mitQualified).toBe(true)
    expect(result.originDecisions.get(URL_A)?.qualificationMethod).toBe('consensus')
    expect(result.verification.originQualified).toBe(1)
  })

  it('graph_refuses_an_uncited_origin_claim', async () => {
    const deps = makeDeps({
      loadOriginTexts: vi.fn(async (urls: readonly string[]) =>
        new Map(
          urls.map((url) => [
            url,
            'This plate is made in Taiwan. All materials are sourced in Taiwan.',
          ]),
        ),
      ),
    })
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [
          {
            ...evaluationFor(URL_A),
            made_in_taiwan: true,
            materials_from_taiwan: true,
            // An id nobody supplied.
            origin_excerpt_ids: ['invented:origin:9'],
          },
        ],
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    const result = await runProductsAgent(baseInput, deps, { model })

    // Deterministic evidence alone is not consensus — the model's half is void.
    expect(result.originDecisions.get(URL_A)?.mitQualified).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Images (decision #35)
  // -------------------------------------------------------------------------

  it('page_images_outside_pool_get_one_classify_batch', async () => {
    const PAGE_IMAGE = 'https://brand.com/img/plate-large.jpg'
    const fetchHtml = vi.fn().mockResolvedValue({
      text: PAGE_HTML(
        `<script type="application/ld+json">{"@type":"Product","image":["${PAGE_IMAGE}"]}</script>`,
      ),
      statusCode: 200,
    })
    const storePageImages = vi.fn().mockResolvedValue(['stored/plate.jpg'])
    const classifyPageImages = vi.fn().mockResolvedValue([
      { id: 'img-new', tag: 'product', score: 95, sourceUrl: URL_A, imageUrl: PAGE_IMAGE },
    ])

    const deps = makeDeps({ fetchHtml, storePageImages, classifyPageImages })
    const model = scriptedModel([
      validProposalResponse({ products: [productFor(URL_A, 'Test Product A')] }),
    ])

    const result = await runProductsAgent(
      // No acquire pool at all: every proposal's page is unrankable, which is
      // what orders the batch.
      { ...baseInput, imagePool: [] },
      deps,
      { model },
    )

    expect(storePageImages).toHaveBeenCalledTimes(1)
    expect(classifyPageImages).toHaveBeenCalledTimes(1)
    expect(storePageImages.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ url: PAGE_IMAGE, pageUrl: URL_A }),
    ])
    expect(classifyPageImages).toHaveBeenCalledWith(['stored/plate.jpg'])

    // The pool the caller publishes from carries the classified keep.
    expect(result.imagePool).toEqual(
      expect.arrayContaining([expect.objectContaining({ imageUrl: PAGE_IMAGE })]),
    )
    expect(result.verification.pageImagesClassified).toBe(1)
    expect(result.verification.image).toBe('verified')
  })

  it('page_image_batch_is_skipped_when_the_pool_already_ranks', async () => {
    const storePageImages = vi.fn()
    const classifyPageImages = vi.fn()
    const deps = makeDeps({ storePageImages, classifyPageImages })

    await runProductsAgent(baseInput, deps, {
      model: scriptedModel([validProposalResponse()]),
    })

    expect(storePageImages).not.toHaveBeenCalled()
    expect(classifyPageImages).not.toHaveBeenCalled()
  })

  it('graph_reports_unverified_image_when_the_pool_is_empty', async () => {
    // No pool AND no way to build one: the run must not report a passing image
    // check just because nothing was there to check.
    const result = await runProductsAgent({ ...baseInput, imagePool: [] }, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
    })

    expect(result.verification.image).toBe('unverified')
    expect(result.verification.imageUnverified).toBeGreaterThan(0)
    expect(result.verification.imageVerified).toBe(0)
    // Unverified is not a drop: the proposals still ship, flagged.
    expect(result.proposals.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Prompt resolution (DEV-1695)
  // -------------------------------------------------------------------------

  it('proposeNode_records_the_resolved_prompt_in_the_decision_trace', async () => {
    // Langfuse creds are blanked in beforeAll, so fetchLangfusePromptWithMeta
    // returns the fallback. The decision trace must contain the prompt source.
    const result = await runProductsAgent(baseInput, makeDeps(), {
      model: scriptedModel([validProposalResponse()]),
    })

    const proposeDecision = result.decisions.find(
      (d) => d.step === 'propose' && d.action === 'prompt resolved',
    )
    expect(proposeDecision).toBeDefined()
    expect(proposeDecision!.reason).toMatch(/prompt=products-propose@\d+ source=(langfuse|snapshot)/)
  })

  it('propose_system_prompt_contains_the_rendered_rubric_and_no_unrendered_placeholder', async () => {
    const model = scriptedModel([validProposalResponse()])

    await runProductsAgent(baseInput, makeDeps(), { model })

    // The system message is the first argument of the first model.invoke call.
    const [messages] = model.invoke.mock.calls[0]!
    const systemContent = String(messages[0]!.content)

    // Rendered editorial bands are present (spot-check two band boundaries).
    expect(systemContent).toContain('0-39')
    expect(systemContent).toContain('90-100')

    // The raw Langfuse placeholder must have been compiled away.
    expect(systemContent).not.toContain('{{editorial_bands}}')
  })

  it('proposeNode_passes_all_four_declared_variables', async () => {
    // Clear captured calls from any prior test, then run the graph.
    promptWithMetaCalls.length = 0
    const model = scriptedModel([validProposalResponse()])

    await runProductsAgent(baseInput, makeDeps(), { model })

    const proposeCall = promptWithMetaCalls.find((c) => c[0] === 'products-propose')
    expect(proposeCall).toBeDefined()
    const variables = proposeCall![1]
    expect(variables).toBeDefined()
    expect(Object.keys(variables!).sort()).toEqual(
      ['category_list', 'editorial_bands', 'material_vocab_block', 'subcategory_vocab_block'],
    )
  })

  it('propose_system_prompt_carries_the_golden_listwise_anchor_id', async () => {
    const model = scriptedModel([validProposalResponse()])

    await runProductsAgent(baseInput, makeDeps(), { model })

    const [messages] = model.invoke.mock.calls[0]!
    const systemContent = String(messages[0]!.content)

    expect(systemContent).toContain('golden_case_id=products-pool-compact-01')
  })

  // -------------------------------------------------------------------------
  // selectCandidates (pure)
  // -------------------------------------------------------------------------

  it('selectCandidates puts priority urls first then pool order, capped at 12', () => {
    // 15 candidates, 2 of which are priority. Output must be priority-first,
    // pool order preserved within each group, and capped at MAX_SELECT (12).
    const pool = Array.from({ length: 15 }, (_, i) => ({
      url: `https://brand.com/p-${i}`,
      normalizedUrl: `https://brand.com/p-${i}`,
      title: `Product ${i}`,
      supplier: 'catalog' as const,
      urlClass: 'product-detail' as const,
    }))
    const priorityUrls = [pool[7]!.url, pool[3]!.url]

    const selected = selectCandidates(pool, priorityUrls)

    expect(selected).toHaveLength(12)
    // Priority urls come first, in the order they appear in the pool (not the
    // order they appear in priorityUrls).
    expect(selected[0]!.url).toBe('https://brand.com/p-3')
    expect(selected[1]!.url).toBe('https://brand.com/p-7')
    // The rest follow pool order, skipping the two already included.
    expect(selected[2]!.url).toBe('https://brand.com/p-0')
    expect(selected[11]!.url).toBe('https://brand.com/p-11')
  })

  // -------------------------------------------------------------------------
  // readNode — deps.readPage override
  // -------------------------------------------------------------------------

  it('readNode uses deps.readPage when present and never calls fetchHtml', async () => {
    const fakeEvidence = {
      url: URL_A,
      title: 'Injected',
      description: null,
      mainText: 'injected text',
      images: [],
      jsonLd: null,
      productSignals: true,
      originExcerpts: [],
      rendered: false,
      statusCode: 200,
    }
    const readPage = vi.fn().mockResolvedValue(fakeEvidence)
    const fetchHtml = vi.fn().mockResolvedValue({ text: PAGE_HTML(), statusCode: 200 })

    const deps = makeDeps({ fetchHtml, readPage })
    const input: ProductsInput = {
      ...baseInput,
      pool: [baseInput.pool[0]!],
      imagePool: [fakeImage(URL_A)],
    }
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [evaluationFor(URL_A)],
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    const result = await runProductsAgent(input, deps, { model })

    // The dep was called instead of fetchHtml.
    expect(readPage).toHaveBeenCalledTimes(1)
    expect(fetchHtml).not.toHaveBeenCalled()
    // Budget still tracks the read.
    expect(result.budget.used.reads).toBe(1)
    expect(result.verification.read).toBe(1)
  })

  // -------------------------------------------------------------------------
  // readNode — cross-page evidence selection (DEV-1855)
  // -------------------------------------------------------------------------

  const CROSS_PAGE_CHROME =
    'Our studio newsletter arrives monthly with notes from the workshop, stories from the makers we admire, and seasonal letters from the hills.'
  const URL_D = 'https://brand.com/product-d'

  function evidenceWithBlocks(url: string) {
    const blocks = [`Unique product copy for ${url}, a hand-thrown cup.`, CROSS_PAGE_CHROME]
    return {
      url,
      title: `Title ${url}`,
      description: null,
      mainText: blocks.join(' '),
      blocks,
      images: [],
      jsonLd: null,
      productSignals: true,
      originExcerpts: [],
      rendered: false,
      statusCode: 200,
    }
  }

  function fourPageInput(): ProductsInput {
    return {
      ...baseInput,
      pool: [
        ...baseInput.pool,
        { url: URL_D, normalizedUrl: URL_D, title: 'Product D', supplier: 'catalog', urlClass: 'product-detail' as const },
      ],
      imagePool: [...baseInput.imagePool, fakeImage(URL_D)],
    }
  }

  it('read_node_dedups_repeated_chrome_across_pages', async () => {
    const readPage = vi.fn(async (url: string) => evidenceWithBlocks(url))
    const deps = makeDeps({ readPage })
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [URL_A, URL_B, URL_C, URL_D].map(evaluationFor),
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    await runProductsAgent(fourPageInput(), deps, { model })

    expect(readPage).toHaveBeenCalledTimes(4)
    const [messages] = model.invoke.mock.calls[0]!
    const userContent = String(messages.find((m) => m.role === 'user')!.content)
    expect(userContent).toContain('Unique product copy for')
    expect(userContent).not.toContain(CROSS_PAGE_CHROME)
    expect(userContent).not.toContain('"blocks"')
  })

  it('read_trace_reports_text_stats', async () => {
    const readPage = vi.fn(async (url: string) => evidenceWithBlocks(url))
    const deps = makeDeps({ readPage })
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [URL_A, URL_B, URL_C, URL_D].map(evaluationFor),
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    const result = await runProductsAgent(fourPageInput(), deps, { model })

    const readDecision = result.decisions.find((d) => d.step === 'read')
    expect(readDecision).toBeDefined()
    expect(readDecision!.reason).toMatch(
      /truncated 0\/4, boilerplate [1-9]\d* chars, omitted \d+ chars$/,
    )
  })

  // -------------------------------------------------------------------------
  // readPage evidence with 404 makes the proposal unreachable
  // -------------------------------------------------------------------------

  it('repairs a name-echo description and publishes the product', async () => {
    const nameEchoResponse = validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 是一個很棒的產品',
        }),
        productFor(URL_B, 'Test Product B'),
      ],
    })
    const repairedResponse = JSON.stringify({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: '義大利植鞣牛皮手染鞋面與鞋墊',
        }),
      ],
    })
    const model = scriptedModel([nameEchoResponse, repairedResponse])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2) // propose + repair
    expect(result.proposals.some(p => p.nameZh === 'Test Product A')).toBe(true)
    expect(result.verification.dropped).toBe(0)
  })

  it('verify decision names repairable description codes', async () => {
    const nameEchoResponse = validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 是一個很棒的產品',
        }),
      ],
    })
    const repairedResponse = JSON.stringify({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: '義大利植鞣牛皮手染鞋面與鞋墊',
        }),
      ],
    })
    const model = scriptedModel([nameEchoResponse, repairedResponse])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    const verifyDecision = result.decisions.find(d => d.step === 'verify')
    expect(verifyDecision?.reason).toContain('description_name_echo')
  })

  it('drops a proposal whose repair returns the same name-echo description', async () => {
    const nameEchoResponse = validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 是一個很棒的產品',
        }),
      ],
    })
    // Repair returns the SAME echoing description
    const stillEchoResponse = JSON.stringify({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 仍然重複了名字',
        }),
      ],
    })
    const model = scriptedModel([nameEchoResponse, stillEchoResponse])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(result.proposals.some(p => p.nameZh === 'Test Product A')).toBe(false)
    expect(result.verification.dropped).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // Origin omission — soft repair (DEV-1856)
  // -------------------------------------------------------------------------

  const NO_ORIGIN_DESC = '手工拉坯的陶瓷盤，直徑 21 公分，釉色溫潤。'
  const WITH_ORIGIN_DESC = '在台灣手工拉坯的陶瓷盤，直徑 21 公分，釉色溫潤。'

  function omittingProposeResponse(): string {
    return validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', { product_description_zh: NO_ORIGIN_DESC }),
        productFor(URL_B, 'Test Product B'),
      ],
    })
  }

  function repairResponse(description: string): string {
    return JSON.stringify({
      products: [productFor(URL_A, 'Test Product A', { product_description_zh: description })],
    })
  }

  it('origin omission is published and repaired', async () => {
    const model = scriptedModel([omittingProposeResponse(), repairResponse(WITH_ORIGIN_DESC)])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const published = result.proposals.filter((p) => p.officialUrl === URL_A)
    expect(published).toHaveLength(1)
    expect(published[0]!.productDescriptionZh).toBe(WITH_ORIGIN_DESC)
    expect(result.verification.originOmitted).toBe(0)
    expect(result.verification.dropped).toBe(0)
    expect(result.agentOutcome).toBe('proposed')
  })

  it('origin omission survives a failed repair', async () => {
    const model = scriptedModel([omittingProposeResponse(), repairResponse(NO_ORIGIN_DESC)])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const published = result.proposals.filter((p) => p.officialUrl === URL_A)
    expect(published).toHaveLength(1)
    expect(published[0]!.productDescriptionZh).toBe(NO_ORIGIN_DESC)
    expect(result.verification.originOmitted).toBe(1)
    expect(result.verification.dropped).toBe(0)
    expect(result.agentOutcome).not.toBe('repaired')
  })

  it('origin omission survives a repair parse failure', async () => {
    const model = scriptedModel([omittingProposeResponse(), 'not valid json {{{{'])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    expect(result.proposals.filter((p) => p.officialUrl === URL_A)).toHaveLength(1)
    expect(result.verification.dropped).toBe(0)
    expect(result.verification.originOmitted).toBe(1)
  })

  it('origin omission survives when no turn remains', async () => {
    const model = scriptedModel([omittingProposeResponse()])

    const result = await runProductsAgent(baseInput, makeDeps(), {
      model,
      budgetOverride: { reads: 12, renders: 4, turns: 1, wallClockMs: 120_000 },
    })

    expect(model.invoke).toHaveBeenCalledTimes(1)
    expect(result.proposals.filter((p) => p.officialUrl === URL_A)).toHaveLength(1)
    expect(result.verification.originOmitted).toBe(1)
    expect(result.verification.dropped).toBe(0)
  })

  it('hard failure plus omission', async () => {
    const proposeResponse = validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 是一個很棒的產品',
        }),
      ],
    })
    // Fixes the name echo, still omits origin.
    const model = scriptedModel([proposeResponse, repairResponse(NO_ORIGIN_DESC)])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const repairUser = JSON.parse(String(model.invoke.mock.calls[1]![0][1]!.content)) as {
      repairable: Array<{ proposal: { official_url: string }; failures: string[] }>
    }
    expect(repairUser.repairable).toHaveLength(1)
    const failures = repairUser.repairable[0]!.failures
    expect(failures.some((f) => f.startsWith('description_name_echo'))).toBe(true)
    expect(failures.some((f) => f.startsWith('description_origin_omitted:'))).toBe(true)

    expect(result.agentOutcome).toBe('repaired')
    expect(result.verification.repaired).toBe(1)
    expect(result.proposals.filter((p) => p.officialUrl === URL_A)).toHaveLength(1)
    expect(result.verification.originOmitted).toBe(1)
    expect(result.verification.dropped).toBe(0)
  })

  it('origin repair matches a soft entry by normalized URL', async () => {
    // Same candidate, spelled with a trailing slash and a tracking param.
    const variant = `${URL_A}/?utm_source=x`
    const repair = JSON.stringify({
      products: [
        productFor(variant, 'Test Product A', { product_description_zh: WITH_ORIGIN_DESC }),
      ],
    })
    const model = scriptedModel([omittingProposeResponse(), repair])

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    const published = result.proposals.filter((p) => p.officialUrl.startsWith(URL_A))
    expect(published).toHaveLength(1)
    expect(published[0]!.officialUrl).toBe(URL_A)
    expect(published[0]!.productDescriptionZh).toBe(WITH_ORIGIN_DESC)
    expect(result.proposals).toHaveLength(2)
    expect(result.verification.dropped).toBe(0)
    expect(result.verification.repaired).toBe(0)
    expect(result.agentOutcome).not.toBe('repaired')
  })

  it('origin repair swaps only the description and keeps the verified key', async () => {
    // Same name twice: the verified keys are distinct, and a re-emitted
    // proposal re-keyed on its own would collide with the first.
    const propose = validProposalResponse({
      products: [
        productFor(URL_A, 'Same Name'),
        productFor(URL_B, 'Same Name', {
          product_description_zh: NO_ORIGIN_DESC,
          material: ['cotton'],
        }),
      ],
    })
    const repair = JSON.stringify({
      products: [
        productFor(URL_B, 'Same Name', {
          name_en: 'Drifted Name',
          category: 'home',
          material: [],
          product_description_zh: WITH_ORIGIN_DESC,
        }),
      ],
    })
    const baseline = await runProductsAgent(baseInput, makeDeps(), {
      model: scriptedModel([propose]),
      budgetOverride: { reads: 12, renders: 4, turns: 1, wallClockMs: 120_000 },
    })
    const original = baseline.proposals.find((p) => p.officialUrl === URL_B)!

    const result = await runProductsAgent(baseInput, makeDeps(), {
      model: scriptedModel([propose, repair]),
    })

    const keys = result.proposals.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    const fixed = result.proposals.find((p) => p.officialUrl === URL_B)!
    expect(fixed).toEqual({ ...original, productDescriptionZh: WITH_ORIGIN_DESC })
  })

  it('origin-only repair turn that throws keeps the verified result', async () => {
    let calls = 0
    const model = {
      invoke: vi.fn(async () => {
        calls += 1
        if (calls > 1) throw new Error('provider 500')
        return {
          content: omittingProposeResponse(),
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }
      }),
    }

    const result = await runProductsAgent(baseInput, makeDeps(), { model })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    expect(result.agentOutcome).toBe('proposed')
    expect(result.proposals.map((p) => p.officialUrl).sort()).toEqual([URL_A, URL_B])
    expect(result.verification.originOmitted).toBe(1)
    expect(result.verification.dropped).toBe(0)
  })

  it('origin-only repair turn that is aborted keeps the verified result', async () => {
    const controller = new AbortController()
    let calls = 0
    const model = {
      invoke: vi.fn(async () => {
        calls += 1
        if (calls > 1) {
          controller.abort()
          throw new DOMException('aborted', 'AbortError')
        }
        return {
          content: omittingProposeResponse(),
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }
      }),
    }

    const result = await runProductsAgent(baseInput, makeDeps(), {
      model,
      signal: controller.signal,
    })

    expect(model.invoke).toHaveBeenCalledTimes(2)
    expect(result.agentOutcome).toBe('proposed')
    expect(result.proposals.map((p) => p.officialUrl).sort()).toEqual([URL_A, URL_B])
    expect(result.verification.originOmitted).toBe(1)
  })

  it('a repair turn with a hard entry still propagates a model error', async () => {
    const proposeResponse = validProposalResponse({
      products: [
        productFor(URL_A, 'Test Product A', {
          product_description_zh: 'Test Product A 是一個很棒的產品',
        }),
      ],
    })
    let calls = 0
    const model = {
      invoke: vi.fn(async () => {
        calls += 1
        if (calls > 1) throw new Error('provider 500')
        return {
          content: proposeResponse,
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }
      }),
    }

    await expect(runProductsAgent(baseInput, makeDeps(), { model })).rejects.toThrow('provider 500')
  })

  it('readPage evidence with statusCode 404 makes the proposal unreachable', async () => {
    const fakeEvidence = {
      url: URL_A,
      title: null,
      description: null,
      mainText: '',
      images: [],
      jsonLd: null,
      productSignals: false,
      originExcerpts: [],
      rendered: false,
      statusCode: 404,
    }
    const readPage = vi.fn().mockResolvedValue(fakeEvidence)
    const deps = makeDeps({ readPage })
    const input: ProductsInput = {
      ...baseInput,
      pool: [baseInput.pool[0]!],
      imagePool: [fakeImage(URL_A)],
    }
    const model = scriptedModel([
      validProposalResponse({
        evaluations: [evaluationFor(URL_A)],
        products: [productFor(URL_A, 'Test Product A')],
      }),
    ])

    const result = await runProductsAgent(input, deps, { model })

    // The 404 evidence causes the proposal to be dropped as unreachable.
    expect(result.verification.dropped).toBeGreaterThan(0)
    expect(Object.keys(result.verification.dropReasons)).toEqual(
      expect.arrayContaining([expect.stringMatching(/reachable|HTTP/i)]),
    )
  })
})
