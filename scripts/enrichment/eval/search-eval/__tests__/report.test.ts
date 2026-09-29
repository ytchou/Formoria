import { expect, it } from 'vitest'

import { writeReport } from '../report'
import type { ExperimentResult } from '@/lib/services/eval/run-experiment'

it('retains per-query scores so original and new holdout slices can be compared', () => {
  const makeItem = (itemId: string, ndcg: number) => ({
    itemId, itemRunId: itemId, ok: true, scores: { 'ndcg@10': ndcg, mrr: ndcg },
    costUsd: 0, latencyMs: 1,
  })
  const result = {
    summary: { total: 4, succeeded: 4, failed: 0 },
    armResults: [
      { arm: 'lexical:idf', items: [makeItem('original-query', 0.5), makeItem('new-query', 0.2)] },
      { arm: 'lexical:tsrank', items: [makeItem('original-query', 0.5), makeItem('new-query', 0.8)] },
    ].map(arm => ({ ...arm, summary: { scorerMeans: {}, costPerItem: 0, p95LatencyMs: 1 } })),
    markdown: '', exitCode: 0,
  } satisfies ExperimentResult

  const report = writeReport(result, { seed: 1900 })

  expect(report.perQuery['lexical:idf']?.['original-query']?.['ndcg@10']).toBe(0.5)
  expect(report.perQuery['lexical:tsrank']?.['new-query']?.['ndcg@10']).toBe(0.8)
})
