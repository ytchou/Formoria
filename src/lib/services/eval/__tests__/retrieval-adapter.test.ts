import { describe, expect, it, vi } from 'vitest'
import {
  createRetrievalAdapter,
  compositeKey,
  type RetrievalAdapterDeps,
} from '../retrieval-adapter'
import type { ExperimentArm, ExperimentItem } from '../run-experiment'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<RetrievalAdapterDeps> = {}): RetrievalAdapterDeps {
  return {
    search: vi.fn().mockResolvedValue({ products: [] }),
    ...overrides,
  }
}

function makeItem(overrides: Partial<ExperimentItem> = {}): ExperimentItem {
  return {
    id: 'q-1',
    input: { query: '送禮推薦', locale: 'zh-TW', category: 'lifestyle' },
    expectedOutput: [
      { key: 'test-brand/product-a', grade: 3 },
      { key: 'test-brand/product-b', grade: 2 },
    ],
    humanApproval: { reviewedVia: 'manual', at: '2026-09-16' },
    ...overrides,
  }
}

function makeArm(overrides: Partial<ExperimentArm> = {}): ExperimentArm {
  return {
    name: 'hybrid',
    type: 'custom',
    value: 'hybrid',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRetrievalAdapter', () => {
  it('task calls search with arm mode and returns composite keys', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      products: [
        { id: 'id-a', key: 'product-a', brandSlug: 'test-brand' },
        { id: 'id-b', key: 'product-b', brandSlug: 'test-brand' },
      ],
    })
    const adapter = createRetrievalAdapter({ search: searchMock })
    const item = makeItem()
    const arm = makeArm({ value: 'hybrid' })

    const result = await adapter.task!(item, arm, { itemRunId: 'run-1' })

    expect(searchMock).toHaveBeenCalledWith({
      query: '送禮推薦',
      locale: 'zh-TW',
      mode: 'hybrid',
      pageSize: 100,
      category: 'lifestyle',
      enableIntentParse: false,
    })
    expect(result.ok).toBe(true)
    expect(result.output).toEqual(['test-brand/product-a', 'test-brand/product-b'])
  })

  it('uses the evaluation item locale for English retrieval', async () => {
    const adapter = createRetrievalAdapter({
      search: async (input) => ({ products: [{ id: 'p1', key: `locale:${input.locale}`, brandSlug: 'test' }] }),
    })

    const result = await adapter.task!(
      makeItem({ input: { query: 'a gift for a tea lover', locale: 'en' } }),
      makeArm({ value: 'vector' }),
      { itemRunId: 'run-en' },
    )

    expect(result.output).toEqual(['test/locale:en'])
  })

  it('expectedOf returns graded items', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const item = makeItem()

    const expected = adapter.expectedOf(item)
    expect(expected).toEqual([
      { key: 'test-brand/product-a', grade: 3 },
      { key: 'test-brand/product-b', grade: 2 },
    ])
  })

  it('scorers include ndcg, precision, recall@100, and mrr', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const names = adapter.scorers.map((s) => s.name)

    expect(names).toContain('ndcg@10')
    expect(names).toContain('precision@5')
    expect(names).toContain('recall@100')
    expect(names).toContain('mrr')
    expect(names).not.toContain('recall@5')
  })

  it('has promptName null', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    expect(adapter.promptName).toBeNull()
  })

  it('mode is scored', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    expect(adapter.mode).toBe('scored')
  })

  it('task dispatches category to deps.category', async () => {
    const categoryMock = vi.fn().mockResolvedValue({
      products: [
        { id: 'id-c', key: 'product-c', brandSlug: 'cat-brand' },
      ],
    })
    const adapter = createRetrievalAdapter(
      makeDeps({ category: categoryMock }),
    )
    const item = makeItem({ input: { query: '茶具推薦', category: 'food' } })
    const arm = makeArm({ name: 'category', value: 'category' })

    const result = await adapter.task!(item, arm, { itemRunId: 'run-2' })

    expect(categoryMock).toHaveBeenCalledWith({ category: 'food', pageSize: 100 })
    expect(result.output).toEqual(['cat-brand/product-c'])
  })

  it('task dispatches category returns empty when no category', async () => {
    const categoryMock = vi.fn()
    const adapter = createRetrievalAdapter(
      makeDeps({ category: categoryMock }),
    )
    const item = makeItem({ input: { query: '茶具推薦' } })
    const arm = makeArm({ name: 'category', value: 'category' })

    const result = await adapter.task!(item, arm, { itemRunId: 'run-3' })
    expect(categoryMock).not.toHaveBeenCalled()
    expect(result.output).toEqual([])
  })

  it('task dispatches rerank to deps.rerank', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      products: [
        { id: 'id-a', key: 'p-a', brandSlug: 'b1', brandName: 'Brand One', nameZh: '產品甲', nameEn: 'Product A', category: 'lifestyle', subcategory: 'tea', productDescriptionZh: '優質好茶' },
        { id: 'id-b', key: 'p-b', brandSlug: 'b2', brandName: 'Brand Two', nameZh: '產品乙', nameEn: null, category: 'food', subcategory: 'snack', productDescriptionZh: '美味零食' },
      ],
    })
    const rerankMock = vi.fn().mockResolvedValue([
      { id: 'id-b' },
      { id: 'id-a' },
    ])
    const adapter = createRetrievalAdapter(
      makeDeps({ search: searchMock, rerank: rerankMock }),
    )
    const item = makeItem()
    const arm = makeArm({ name: 'rerank', value: 'rerank' })

    const result = await adapter.task!(item, arm, { itemRunId: 'run-4' })

    expect(rerankMock).toHaveBeenCalledWith(
      '送禮推薦',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'id-a',
          document: expect.stringContaining('優質好茶'),
        }),
      ]),
    )
    expect(result.output).toEqual(['b2/p-b', 'b1/p-a'])
  })

  it('task dispatches ltr:<version> to deps.rank', async () => {
    const rankMock = vi.fn().mockResolvedValue(['b1/p1', 'b2/p2'])
    const adapter = createRetrievalAdapter(
      makeDeps({ rank: rankMock }),
    )
    const item = makeItem({ input: { query: '送禮推薦', category: 'lifestyle' } })
    const arm = makeArm({ name: 'ltr:v1', value: 'ltr:v1' })

    const result = await adapter.task!(item, arm, { itemRunId: 'run-5' })

    expect(rankMock).toHaveBeenCalledWith({
      query: '送禮推薦',
      version: 'v1',
      category: 'lifestyle',
    })
    expect(result.output).toEqual(['b1/p1', 'b2/p2'])
  })

  it('task throws when ltr arm but rank dep undefined', async () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const item = makeItem()
    const arm = makeArm({ name: 'ltr:v1', value: 'ltr:v1' })

    await expect(adapter.task!(item, arm, { itemRunId: 'run-6' })).rejects.toThrow(
      'rank dep required',
    )
  })

  it('expectedOf parses composite keys', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const schema = adapter.expectedSchema

    const valid = schema.safeParse([{ key: 'goodglas/tea-pot', grade: 3 }])
    expect(valid.success).toBe(true)

    const invalid = schema.safeParse([{ key: 'no-slash-key', grade: 1 }])
    expect(invalid.success).toBe(false)
  })

  it('scorers use composite keys', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const ndcgScorer = adapter.scorers.find((s) => s.name === 'ndcg@10')!

    // Perfect order with composite keys
    const retrieved = ['brand/a', 'brand/b', 'brand/c']
    const expected = [
      { key: 'brand/a', grade: 3 },
      { key: 'brand/b', grade: 2 },
      { key: 'brand/c', grade: 1 },
    ]

    expect(ndcgScorer.fn(retrieved, expected)).toBeCloseTo(1.0)
  })

  it('binary metrics treat only grade > 0 as relevant', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const precisionScorer = adapter.scorers.find((s) => s.name === 'precision@5')!
    const recallScorer = adapter.scorers.find((s) => s.name === 'recall@100')!
    const mrrScorer = adapter.scorers.find((s) => s.name === 'mrr')!

    // grade-0 items should be ignored for binary metrics
    const retrieved = ['brand/a', 'brand/b', 'brand/c']
    const expected = [
      { key: 'brand/a', grade: 3 },
      { key: 'brand/b', grade: 0 }, // should be excluded
      { key: 'brand/d', grade: 2 },
    ]

    // Relevant keys: brand/a, brand/d (grade > 0)
    // Retrieved top-5: brand/a, brand/b, brand/c
    // Precision@5: 1 hit / 5 = 0.2
    expect(precisionScorer.fn(retrieved, expected)).toBeCloseTo(1 / 5)

    // Recall@100: 1 hit / 2 relevant = 0.5
    expect(recallScorer.fn(retrieved, expected)).toBeCloseTo(0.5)

    // MRR: first relevant hit is brand/a at position 1 → 1/1 = 1
    expect(mrrScorer.fn(retrieved, expected)).toBe(1)
  })
})

describe('compositeKey', () => {
  it('joins brandSlug and key with /', () => {
    expect(compositeKey({ brandSlug: 'goodglas', key: 'tea-pot' })).toBe(
      'goodglas/tea-pot',
    )
  })
})
