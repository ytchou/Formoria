import { describe, expect, it, vi } from 'vitest'
import type { ProductPageEvidence } from '../../enrich-phases/products/read-page'
import type { ProductsOutput } from '../../enrich-phases/products/graph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(url: string, overrides: Partial<ProductPageEvidence> = {}): ProductPageEvidence {
  return {
    url,
    title: `Product at ${url}`,
    description: 'A product page',
    mainText: 'Product description text',
    images: [],
    jsonLd: null,
    productSignals: true,
    originExcerpts: [],
    rendered: false,
    statusCode: 200,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReplayInput', () => {
  it('rebuilds ProductsInput with a Map of candidate ids, empty imagePool, and priorityProductUrls equal to the recorded pool order', async () => {
    const { buildReplayInput } = await import('../products-replay')

    const input = {
      brand: { id: 'b1', slug: 'test-brand', name: 'Test Brand' },
      pool: [
        { url: 'https://test.com/p1', normalizedUrl: 'https://test.com/p1', supplier: 'search', urlClass: 'product-detail' as const },
        { url: 'https://test.com/p2', normalizedUrl: 'https://test.com/p2', supplier: 'search', urlClass: 'product-detail' as const },
      ],
      candidateIdsByUrl: { 'https://test.com/p1': 'id-1', 'https://test.com/p2': 'id-2' },
      priorityProductUrls: ['https://test.com/p1', 'https://test.com/p2'],
      evidence: {},
    }

    const result = buildReplayInput(input)

    // candidateIdsByUrl is a Map
    expect(result.candidateIdsByUrl).toBeInstanceOf(Map)
    expect(result.candidateIdsByUrl!.get('https://test.com/p1')).toBe('id-1')
    expect(result.candidateIdsByUrl!.get('https://test.com/p2')).toBe('id-2')

    // imagePool is empty
    expect(result.imagePool).toEqual([])

    // priorityProductUrls matches recorded pool order
    expect(result.priorityProductUrls).toEqual(['https://test.com/p1', 'https://test.com/p2'])

    // pool candidates are present
    expect(result.pool).toHaveLength(2)
    expect(result.pool[0]!.url).toBe('https://test.com/p1')
  })
})

describe('frozenReadPage', () => {
  it('returns frozen evidence for known URLs and throws on unknown URLs', async () => {
    const { frozenReadPage } = await import('../products-replay')

    const evidence = makeEvidence('https://test.com/p1')
    const readPage = frozenReadPage(new Map([['https://test.com/p1', evidence]]))

    // Known URL returns evidence
    const result = await readPage('https://test.com/p1', {} as never)
    expect(result.url).toBe('https://test.com/p1')
    expect(result.title).toBe('Product at https://test.com/p1')

    // Unknown URL throws
    await expect(readPage('https://unknown.com/x', {} as never)).rejects.toThrow()
  })
})

describe('deadFetch', () => {
  it('returns an empty body with 404 status', async () => {
    const { deadFetch } = await import('../products-replay')
    const result = await deadFetch('https://example.com')
    expect(result.text).toBe('')
    expect(result.statusCode).toBe(404)
  })
})

describe('productsTask', () => {
  it('returns promptMeta parsed from the propose decision', async () => {
    const { productsTask } = await import('../products-replay')

    const fakeRunProductsAgent = vi.fn<() => Promise<ProductsOutput>>().mockResolvedValue({
      agentOutcome: 'proposed',
      proposals: [{ officialUrl: 'https://test.com/p1', nameZh: '測試', nameEn: 'Test', category: 'beauty', productDescriptionZh: '描述', sources: [] }] as never,
      verification: {} as never,
      decisions: [
        { step: 'propose', action: 'prompt resolved', reason: 'prompt=products-propose@3', ms: 10 },
      ],
      originDecisions: new Map(),
      evaluations: new Map([
        ['https://test.com/p1', { score: 80, searchPosition: 1 }],
      ]) as never,
      imagePool: [],
      budget: { allowed: { reads: 12, renders: 0, turns: 6, wallClockMs: 120000 }, used: { reads: 1, renders: 0, turns: 1, wallClockMs: 5000 } },
    })
    const fakeCreateAgentModel = vi.fn().mockResolvedValue({ invoke: vi.fn() })

    const task = productsTask({
      createAgentModel: fakeCreateAgentModel,
      runProductsAgent: fakeRunProductsAgent,
    })

    const item = {
      id: 'item-1',
      input: {
        brand: { id: 'b1', slug: 'test', name: 'Test' },
        pool: [{ url: 'https://test.com/p1', normalizedUrl: 'https://test.com/p1', supplier: 'search', urlClass: 'product-detail' }],
        candidateIdsByUrl: { 'https://test.com/p1': 'cid-1' },
        priorityProductUrls: ['https://test.com/p1'],
        evidence: { 'https://test.com/p1': makeEvidence('https://test.com/p1') },
      },
      expectedOutput: { decisions: [] },
      humanApproval: { reviewedVia: 'langfuse-queue' },
    }

    const result = await task(item as never, { name: 'arm-1', type: 'model' as const, value: 'gpt-5.6' }, { itemRunId: 'run-1', model: 'gpt-5.6' })

    expect(result.ok).toBe(true)
    expect(result.promptMeta).toEqual({ name: 'products-propose', version: 3 })
  })

  it('returns ok:false when LANGFUSE_PROMPT_VERSIONS pins products-propose and the graph resolved to fallback', async () => {
    const { productsTask } = await import('../products-replay')

    const fakeRunProductsAgent = vi.fn<() => Promise<ProductsOutput>>().mockResolvedValue({
      agentOutcome: 'proposed',
      proposals: [{ officialUrl: 'https://test.com/p1', nameZh: '測試', nameEn: 'Test', category: 'beauty', productDescriptionZh: '描述', sources: [] }] as never,
      verification: {} as never,
      decisions: [
        { step: 'propose', action: 'prompt resolved', reason: 'prompt=fallback', ms: 10 },
      ],
      originDecisions: new Map(),
      evaluations: new Map([['https://test.com/p1', { score: 80, searchPosition: 1 }]]) as never,
      imagePool: [],
      budget: { allowed: { reads: 12, renders: 0, turns: 6, wallClockMs: 120000 }, used: { reads: 1, renders: 0, turns: 1, wallClockMs: 5000 } },
    })
    const fakeCreateAgentModel = vi.fn().mockResolvedValue({ invoke: vi.fn() })

    const task = productsTask({
      createAgentModel: fakeCreateAgentModel,
      runProductsAgent: fakeRunProductsAgent,
    })

    // Set pin environment
    const prev = process.env.LANGFUSE_PROMPT_VERSIONS
    process.env.LANGFUSE_PROMPT_VERSIONS = 'products-propose:5'

    try {
      const item = {
        id: 'item-1',
        input: {
          brand: { id: 'b1', slug: 'test', name: 'Test' },
          pool: [{ url: 'https://test.com/p1', normalizedUrl: 'https://test.com/p1', supplier: 'search', urlClass: 'product-detail' }],
          candidateIdsByUrl: { 'https://test.com/p1': 'cid-1' },
          priorityProductUrls: ['https://test.com/p1'],
          evidence: { 'https://test.com/p1': makeEvidence('https://test.com/p1') },
        },
        expectedOutput: { decisions: [] },
        humanApproval: { reviewedVia: 'langfuse-queue' },
      }

      const result = await task(item as never, { name: 'arm-1', type: 'model' as const, value: 'gpt-5.6' }, { itemRunId: 'run-1' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('pinned prompt fell back')
    } finally {
      if (prev !== undefined) {
        process.env.LANGFUSE_PROMPT_VERSIONS = prev
      } else {
        delete process.env.LANGFUSE_PROMPT_VERSIONS
      }
    }
  })

  it('replays a scripted model on frozen evidence and returns evaluations/selected', async () => {
    const { productsTask } = await import('../products-replay')

    const fakeEvaluations = new Map([
      ['https://test.com/p1', { score: 85, searchPosition: 1 }],
      ['https://test.com/p2', { score: 60, searchPosition: 2 }],
    ])

    const fakeRunProductsAgent = vi.fn<() => Promise<ProductsOutput>>().mockResolvedValue({
      agentOutcome: 'proposed',
      proposals: [
        { officialUrl: 'https://test.com/p1', nameZh: '產品1', nameEn: 'P1', category: 'beauty', productDescriptionZh: '描述', sources: [] },
      ] as never,
      verification: {} as never,
      decisions: [
        { step: 'propose', action: 'prompt resolved', reason: 'prompt=products-propose@2', ms: 10 },
      ],
      originDecisions: new Map(),
      evaluations: fakeEvaluations as never,
      imagePool: [],
      budget: { allowed: { reads: 12, renders: 0, turns: 6, wallClockMs: 120000 }, used: { reads: 2, renders: 0, turns: 1, wallClockMs: 3000 } },
    })
    const fakeCreateAgentModel = vi.fn().mockResolvedValue({ invoke: vi.fn() })

    const task = productsTask({
      createAgentModel: fakeCreateAgentModel,
      runProductsAgent: fakeRunProductsAgent,
    })

    const item = {
      id: 'item-1',
      input: {
        brand: { id: 'b1', slug: 'test', name: 'Test' },
        pool: [
          { url: 'https://test.com/p1', normalizedUrl: 'https://test.com/p1', supplier: 'search', urlClass: 'product-detail' },
          { url: 'https://test.com/p2', normalizedUrl: 'https://test.com/p2', supplier: 'search', urlClass: 'product-detail' },
        ],
        candidateIdsByUrl: { 'https://test.com/p1': 'cid-1', 'https://test.com/p2': 'cid-2' },
        priorityProductUrls: ['https://test.com/p1', 'https://test.com/p2'],
        evidence: {
          'https://test.com/p1': makeEvidence('https://test.com/p1'),
          'https://test.com/p2': makeEvidence('https://test.com/p2'),
        },
      },
      expectedOutput: { decisions: [] },
      humanApproval: { reviewedVia: 'langfuse-queue' },
    }

    const result = await task(item as never, { name: 'arm-1', type: 'model' as const, value: 'gpt-5.6' }, { itemRunId: 'run-1' })

    expect(result.ok).toBe(true)
    expect(result.output).toBeDefined()
    const output = result.output as { evaluations: unknown; selected: string[] }
    expect(output.selected).toEqual(['https://test.com/p1'])
    expect(output.evaluations).toBeDefined()

    // Verify runProductsAgent was called with frozenReadPage (readPage) and deadFetch
    const callArgs = fakeRunProductsAgent.mock.calls[0] as unknown as unknown[]
    const deps = callArgs[1] as { readPage: unknown; fetchHtml: unknown }
    expect(typeof deps.readPage).toBe('function')
    expect(typeof deps.fetchHtml).toBe('function')

    // deadFetch returns 404
    const fetchResult = await (deps.fetchHtml as (url: string) => Promise<{ text: string; statusCode: number }>)('https://example.com')
    expect(fetchResult.statusCode).toBe(404)
  })

  it('fallback outcome yields ok:false', async () => {
    const { productsTask } = await import('../products-replay')

    const fakeRunProductsAgent = vi.fn<() => Promise<ProductsOutput>>().mockResolvedValue({
      agentOutcome: 'fallback',
      proposals: [],
      verification: {} as never,
      decisions: [
        { step: 'propose', action: 'prompt resolved', reason: 'prompt=products-propose@1', ms: 10 },
      ],
      originDecisions: new Map(),
      evaluations: new Map() as never,
      imagePool: [],
      budget: { allowed: { reads: 12, renders: 0, turns: 6, wallClockMs: 120000 }, used: { reads: 1, renders: 0, turns: 2, wallClockMs: 10000 } },
      error: 'no_proposals',
    })
    const fakeCreateAgentModel = vi.fn().mockResolvedValue({ invoke: vi.fn() })

    const task = productsTask({
      createAgentModel: fakeCreateAgentModel,
      runProductsAgent: fakeRunProductsAgent,
    })

    const item = {
      id: 'item-1',
      input: {
        brand: { id: 'b1', slug: 'test', name: 'Test' },
        pool: [{ url: 'https://test.com/p1', normalizedUrl: 'https://test.com/p1', supplier: 'search', urlClass: 'product-detail' }],
        candidateIdsByUrl: { 'https://test.com/p1': 'cid-1' },
        priorityProductUrls: ['https://test.com/p1'],
        evidence: { 'https://test.com/p1': makeEvidence('https://test.com/p1') },
      },
      expectedOutput: { decisions: [] },
      humanApproval: { reviewedVia: 'langfuse-queue' },
    }

    const result = await task(item as never, { name: 'arm-1', type: 'model' as const, value: 'gpt-5.6' }, { itemRunId: 'run-1' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('fallback')
  })
})

describe('adapter.summarize', () => {
  it('returns the calibration markdown with confusion matrix, tie-break, and window sweep headings', async () => {
    const { summarizeCalibration } = await import('../products-calibration')

    // Build minimal CalibrationResults
    const { bandConfusion, tieBreakAblation, windowSweep } = await import('../products-calibration')

    const output = {
      evaluations: {
        'https://test.com/p1': { score: 80, searchPosition: 1 },
        'https://test.com/p2': { score: 40, searchPosition: 2 },
      },
      selected: ['https://test.com/p1'],
      proposals: [] as never[],
      agentOutcome: 'proposed',
    }

    const expected = {
      decisions: [
        { candidateUrl: 'https://test.com/p1', selected: true, approvedBand: 'exceptional' as const, relativeRank: 1 },
        { candidateUrl: 'https://test.com/p2', selected: false, approvedBand: 'ineligible' as const, relativeRank: 2 },
      ],
    }

    const results = {
      confusion: bandConfusion(output, expected),
      tieBreak: tieBreakAblation(output, expected),
      windowSweep: windowSweep(output, expected),
    }

    const md = summarizeCalibration(results)
    expect(md).toContain('## Band Confusion Matrix')
    expect(md).toContain('## Tie-Break Ablation')
    expect(md).toContain('## Window Sweep')
  })
})
