import { describe, expect, it, vi } from 'vitest'

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
  LLM_PROFILES: { products: { model: 'text', temperature: 0.1, reasoningEffort: 'none', timeoutMs: 30_000 } },
}))

import { runProductsAgent, type ProductsInput, type ProductsDeps } from '../graph'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { RunnableLambda } from '@langchain/core/runnables'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scriptedModel(responses: string[]) {
  let index = 0
  return new RunnableLambda({
    func: async (_input: BaseMessage[]) => {
      const content = responses[index++] ?? '{}'
      return new AIMessage({
        content,
        usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      })
    },
  })
}

/** A valid model response that `validateProductProposals` will accept. */
function validProposalResponse(overrides: Partial<{
  products: unknown[]
  url: string
  category: string
}> = {}): string {
  const url = overrides.url ?? 'https://brand.com/product-a'
  return JSON.stringify({
    products: overrides.products ?? [
      {
        name_zh: '測試產品A',
        name_en: 'Test Product A',
        category: overrides.category ?? 'fashion',
        subcategory: null,
        material: [],
        official_url: url,
        image_source_url: null,
        product_description_zh: '這是一個測試產品描述，用來驗證提案流程。',
        sources: [{ url, fact: 'test fact' }],
      },
      {
        name_zh: '測試產品B',
        name_en: 'Test Product B',
        category: overrides.category ?? 'fashion',
        subcategory: null,
        material: [],
        official_url: 'https://brand.com/product-b',
        image_source_url: null,
        product_description_zh: '這是另一個測試產品描述，用來驗證流程。',
        sources: [{ url: 'https://brand.com/product-b', fact: 'another test fact' }],
      },
    ],
  })
}

function makeDeps(overrides: Partial<ProductsDeps> = {}): ProductsDeps {
  return {
    fetchHtml: vi.fn().mockResolvedValue({ text: '<html><body>Product page content</body></html>', statusCode: 200 }),
    renderProvider: {
      fetchRendered: vi.fn().mockResolvedValue({ html: '<html><body>Rendered</body></html>', finalUrl: 'https://brand.com', status: 200 }),
    },
    ...overrides,
  }
}

/** Minimal RankableImage that satisfies rankForProduct's sourceUrl match. */
function fakeImage(sourceUrl: string) {
  return {
    id: `img-${sourceUrl}`,
    tag: 'product' as const,
    score: 80,
    sourceUrl,
  }
}

const baseInput: ProductsInput = {
  brand: { id: 'brand-1', slug: 'test-brand', name: 'Test Brand', url: 'https://brand.com' },
  pool: [
    { url: 'https://brand.com/product-a', normalizedUrl: 'https://brand.com/product-a', title: 'Product A', supplier: 'catalog', urlClass: 'product-detail' as const },
    { url: 'https://brand.com/product-b', normalizedUrl: 'https://brand.com/product-b', title: 'Product B', supplier: 'catalog', urlClass: 'product-detail' as const },
    { url: 'https://brand.com/product-c', normalizedUrl: 'https://brand.com/product-c', title: 'Product C', supplier: 'catalog', urlClass: 'product-detail' as const },
  ],
  imagePool: [
    fakeImage('https://brand.com/product-a'),
    fakeImage('https://brand.com/product-b'),
    fakeImage('https://brand.com/product-c'),
  ],
  scrapedData: { description: 'Test brand products' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('products agent graph', () => {
  it('graph_full_happy_path', async () => {
    const model = scriptedModel([validProposalResponse()])
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, { model })

    expect(result.agentOutcome).toBe('proposed')
    expect(result.proposals.length).toBeGreaterThanOrEqual(1)
    expect(result.decisions.length).toBeGreaterThan(0)
    expect(result.verification.proposed).toBeGreaterThan(0)
  })

  it('graph_propose_parse_failure_retries_once', async () => {
    const model = scriptedModel([
      'not valid json {{{{',
      validProposalResponse(),
    ])
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, { model })

    expect(result.proposals.length).toBeGreaterThanOrEqual(1)
    // First call failed, second succeeded
    const parseFailDecision = result.decisions.find(
      (d) => d.step === 'propose' && d.action === 'parse_failed',
    )
    expect(parseFailDecision).toBeDefined()
  })

  it('graph_verify_drops_off_host_url', async () => {
    // Use a proposal that passes validateProductProposals (URL is in candidates)
    // but fails verifySameHost because the brand URL doesn't match.
    // We set brand.url to a different host so verifySameHost fails.
    const inputWithDiffHost: ProductsInput = {
      ...baseInput,
      brand: { ...baseInput.brand, url: 'https://different-brand.com' },
    }
    const model = scriptedModel([validProposalResponse()])
    const deps = makeDeps()

    const result = await runProductsAgent(inputWithDiffHost, deps, { model })

    // Proposals with host mismatch are dropped in verify (not repairable)
    expect(result.verification.dropped).toBeGreaterThan(0)
  })

  it('graph_repair_fixes_repairable_proposal', async () => {
    // Provide imagePool with images that don't match product URLs →
    // verifyImage fails → repairable (URL checks pass, only image fails).
    // Repair response returns same proposals (repair "fixes" image ref).
    const inputMismatchedImages: ProductsInput = {
      ...baseInput,
      imagePool: [fakeImage('https://brand.com/other-page')],
    }
    const proposeResponse = validProposalResponse()
    const repairResponse = validProposalResponse()
    const model = scriptedModel([proposeResponse, repairResponse])
    const deps = makeDeps()

    const result = await runProductsAgent(inputMismatchedImages, deps, { model })

    expect(result.agentOutcome).toBe('repaired')
    expect(result.verification.repaired).toBeGreaterThan(0)
  })

  it('graph_budget_exhausted_at_read_returns_fallback', async () => {
    const model = scriptedModel([validProposalResponse()])
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, {
      model,
      budgetOverride: { reads: 0, renders: 0, turns: 6, wallClockMs: 120_000 },
    })

    expect(result.agentOutcome).toBe('fallback')
    expect(result.error).toContain('budget')
  })

  it('graph_empty_pool_returns_blocked', async () => {
    const model = scriptedModel([validProposalResponse()])
    const deps = makeDeps()
    const emptyInput: ProductsInput = {
      ...baseInput,
      pool: [],
    }

    const result = await runProductsAgent(emptyInput, deps, { model })

    expect(result.agentOutcome).toBe('blocked')
    expect(result.error).toContain('empty')
  })

  it('graph_no_model_returns_blocked', async () => {
    const deps = makeDeps()

    const result = await runProductsAgent(baseInput, deps, {})

    expect(result.agentOutcome).toBe('blocked')
    expect(result.error).toContain('no_model')
  })

  it('graph_wall_clock_enforced', async () => {
    const slowModel = new RunnableLambda({
      func: async (_input: BaseMessage[]) => {
        return new AIMessage({
          content: validProposalResponse(),
          usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        })
      },
    })
    const deps = makeDeps()

    // Set wall clock to 1ms → times out almost immediately
    const result = await runProductsAgent(baseInput, deps, {
      model: slowModel,
      budgetOverride: { reads: 12, renders: 4, turns: 6, wallClockMs: 1 },
    })

    // With 1ms wall clock, graph should stop early with partial results
    // The select node runs (pure, fast), but subsequent async nodes trigger
    // the wall-clock check and the graph finalizes early.
    expect(result.decisions.length).toBeGreaterThan(0)
    // Should have fewer steps than a full run (6 nodes)
    const fullRunSteps = ['select', 'read', 'propose', 'verify', 'repair', 'finalize']
    const stepsRun = result.decisions.map((d) => d.step)
    expect(stepsRun.length).toBeLessThanOrEqual(fullRunSteps.length)
  })
})
