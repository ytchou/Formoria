import { describe, expect, it } from 'vitest'

import { compactSweepResults, expandLexicalGrid, pickSweepWinner, sweepItems } from '../lexical-sweep'

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

  it('keeps every configuration metric and per-query evidence for the compared winners', () => {
    const results = [
      { id: 'bm25f-a', params: { scorer: 'bm25f' as const }, ndcgAt10: 0.51, mrr: 0.6, p95LatencyMs: 42, failed: 0, scoresByQuery: { 'tea-gift': { ndcgAt10: 0.4, mrr: 1 } } },
      { id: 'bm25f-b', params: { scorer: 'bm25f' as const }, ndcgAt10: 0.55, mrr: 0.7, p95LatencyMs: 45, failed: 0, scoresByQuery: { 'tea-gift': { ndcgAt10: 0.6, mrr: 1 } } },
      { id: 'tsrank-a', params: { scorer: 'tsrank' as const }, ndcgAt10: 0.52, mrr: 0.65, p95LatencyMs: 38, failed: 0, scoresByQuery: { 'tea-gift': { ndcgAt10: 0.5, mrr: 1 } } },
    ]
    const compact = compactSweepResults(results)

    expect(compact.map(result => [result.id, result.ndcgAt10, result.mrr, result.p95LatencyMs, result.failed])).toEqual(
      results.map(result => [result.id, result.ndcgAt10, result.mrr, result.p95LatencyMs, result.failed]),
    )
    expect(compact.find(result => result.id === 'bm25f-a')).not.toHaveProperty('scoresByQuery')
    expect(compact.find(result => result.id === 'bm25f-b')).toHaveProperty(
      'scoresByQuery', results.find(result => result.id === 'bm25f-b')?.scoresByQuery,
    )
    expect(compact.find(result => result.id === 'tsrank-a')).toHaveProperty(
      'scoresByQuery', results.find(result => result.id === 'tsrank-a')?.scoresByQuery,
    )
  })
})
