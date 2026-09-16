import { describe, expect, it, vi } from 'vitest'
import { createRetrievalAdapter, type RetrievalAdapterDeps } from '../retrieval-adapter'
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
    input: { query: '送禮推薦', locale: 'zh-TW' },
    expectedOutput: [
      { key: 'product-a', grade: 3 },
      { key: 'product-b', grade: 2 },
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
  it('task calls search with arm mode', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      products: [{ key: 'product-a' }, { key: 'product-b' }],
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
    })
    expect(result.ok).toBe(true)
    expect(result.output).toEqual(['product-a', 'product-b'])
  })

  it('uses the evaluation item locale for English retrieval', async () => {
    const adapter = createRetrievalAdapter({
      search: async (input) => ({ products: [{ key: `locale:${input.locale}` }] }),
    })

    const result = await adapter.task!(
      makeItem({ input: { query: 'a gift for a tea lover', locale: 'en' } }),
      makeArm({ value: 'vector' }),
      { itemRunId: 'run-en' },
    )

    expect(result.output).toEqual(['locale:en'])
  })

  it('expectedOf returns graded items', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const item = makeItem()

    const expected = adapter.expectedOf(item)
    expect(expected).toEqual([
      { key: 'product-a', grade: 3 },
      { key: 'product-b', grade: 2 },
    ])
  })

  it('scorers include ndcg, precision, recall, and mrr', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    const names = adapter.scorers.map((s) => s.name)

    expect(names).toContain('ndcg@10')
    expect(names).toContain('precision@5')
    expect(names).toContain('recall@5')
    expect(names).toContain('mrr')
  })

  it('has promptName null', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    expect(adapter.promptName).toBeNull()
  })

  it('mode is scored', () => {
    const adapter = createRetrievalAdapter(makeDeps())
    expect(adapter.mode).toBe('scored')
  })
})
