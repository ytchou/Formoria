import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { CompiledStateGraph } from '@langchain/langgraph'

import {
  buildProductsGraph,
  createProductsRunContext,
  runProductsAgent,
  PRODUCTS_RECURSION_LIMIT,
  type ProductsDeps,
  type ProductsInput,
} from '../graph'
import { PRODUCTS_BUDGET_CEILINGS } from '../budget'

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

/** A plain-object chat model, the shape `AgentModel` declares. */
function scriptedModel(responses: string[]) {
  let index = 0
  const invoke = vi.fn(async (_messages: BaseMessage[]) => {
    const content = responses[index++] ?? responses.at(-1) ?? '{}'
    return new AIMessage({
      content,
      usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    })
  })
  return { invoke }
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
    product_description_zh: '這是一個測試產品描述，用來驗證提案流程。',
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
})
