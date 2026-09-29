import { describe, expect, it } from 'vitest'

import { expandLexicalGrid, pickSweepWinner, sweepItems } from '../lexical-sweep'

describe('lexical scorer sweep', () => {
  it('tests every specified BM25F and weighted tsrank setting', () => {
    const grid = expandLexicalGrid()
    expect(grid).toHaveLength(28)
    expect(grid.filter(item => item.params.scorer === 'bm25f')).toHaveLength(24)
    expect(grid.filter(item => item.params.scorer === 'tsrank')).toHaveLength(4)
    expect(new Set(grid.map(item => item.id)).size).toBe(28)
    expect(grid).toContainEqual({
      id: 'bm25f-k1.2-b0.75-w1-0.8-0.4-0.2',
      params: { scorer: 'bm25f', k1: 1.2, b: 0.75, wA: 1, wB: 0.8, wC: 0.4, wD: 0.2 },
    })
  })

  it('keeps the holdout query out of the tuning run', () => {
    const items = [
      { id: 'tea-gift', split: 'train' as const },
      { id: 'canvas-tote', split: 'val' as const },
      { id: 'ceramic-cup', split: 'holdout' as const },
    ]
    expect(sweepItems(items).map(item => item.id)).toEqual(['tea-gift', 'canvas-tote'])
  })

  it('picks highest NDCG@10, breaking an exact tie with MRR', () => {
    const results = [
      { id: 'bm25f-a', ndcgAt10: 0.51, mrr: 0.45 },
      { id: 'tsrank-b', ndcgAt10: 0.52, mrr: 0.3 },
      { id: 'tsrank-c', ndcgAt10: 0.52, mrr: 0.4 },
    ]
    expect(pickSweepWinner(results)?.id).toBe('tsrank-c')
  })
})
