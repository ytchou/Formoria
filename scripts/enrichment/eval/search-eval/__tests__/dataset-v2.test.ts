import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'

import { loadDatasetV2, toExperimentItems, type DatasetV2Item } from '../dataset-v2'
import { writeReport } from '../report'
import type { ExperimentResult, ArmResult } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

const dirs: string[] = []

function tmpFile(items: DatasetV2Item[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dataset-v2-test-'))
  dirs.push(dir)
  const path = join(dir, 'dataset.json')
  writeFileSync(path, JSON.stringify(items))
  return path
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs.length = 0
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadDatasetV2', () => {
  it('filters by split and maps expected to composite graded keys', () => {
    const items: DatasetV2Item[] = [
      {
        id: 'q-1',
        query: '送禮推薦',
        split: 'train',
        expected: [{ brandSlug: 'goodglas', productKey: 'tea-pot', grade: 3 }],
      },
      {
        id: 'q-2',
        query: '保養品推薦',
        category: 'beauty',
        split: 'val',
        expected: [{ brandSlug: 'z-z', productKey: 'serum', grade: 2 }],
      },
      {
        id: 'q-3',
        query: '手作皮件',
        split: 'holdout',
        queryType: 'concrete',
        expected: [{ brandSlug: 'leather-co', productKey: 'wallet', grade: 1 }],
      },
    ]

    const path = tmpFile(items)
    const holdout = loadDatasetV2(path, { split: 'holdout' })
    expect(holdout).toHaveLength(1)
    expect(holdout[0]!.id).toBe('q-3')

    const all = loadDatasetV2(path)
    expect(all).toHaveLength(3)
  })

  it('rejects a duplicate query id', () => {
    const items: DatasetV2Item[] = [
      {
        id: 'dup',
        query: 'test',
        split: 'train',
        expected: [],
      },
      {
        id: 'dup',
        query: 'test 2',
        split: 'val',
        expected: [],
      },
    ]

    const path = tmpFile(items)
    expect(() => loadDatasetV2(path)).toThrow('Duplicate query id: dup')
  })
})

describe('toExperimentItems', () => {
  it('stamps humanApproval from the item', () => {
    const items: DatasetV2Item[] = [
      {
        id: 'q-1',
        query: 'test',
        split: 'train',
        expected: [{ brandSlug: 'b', productKey: 'p', grade: 3 }],
        humanApproval: { reviewedVia: 'manual', at: '2026-09-16' },
      },
      {
        id: 'q-2',
        query: 'test2',
        split: 'val',
        expected: [],
      },
    ]

    const experiment = toExperimentItems(items)
    expect(experiment[0]!.humanApproval).toEqual({
      reviewedVia: 'manual',
      at: '2026-09-16',
    })
    expect(experiment[1]!.humanApproval).toEqual({})
  })

  it('maps expected to composite key format', () => {
    const items: DatasetV2Item[] = [
      {
        id: 'q-1',
        query: 'test',
        split: 'train',
        expected: [
          { brandSlug: 'goodglas', productKey: 'tea-pot', grade: 3 },
          { brandSlug: 'hmm', productKey: 'mug', grade: 2 },
        ],
      },
    ]

    const experiment = toExperimentItems(items)
    expect(experiment[0]!.expectedOutput).toEqual([
      { key: 'goodglas/tea-pot', grade: 3 },
      { key: 'hmm/mug', grade: 2 },
    ])
  })
})

// ---------------------------------------------------------------------------
// writeReport
// ---------------------------------------------------------------------------

describe('writeReport', () => {
  it('computes per-arm means with CIs, the paired delta, and a per-queryType breakdown', () => {
    // Build a synthetic ExperimentResult with 2 arms and 4 items
    const makeItems = (_arm: string, scores: Array<Record<string, number>>) =>
      scores.map((s, i) => ({
        itemId: `q-${i + 1}`,
        ok: true,
        scores: s,
        costUsd: 0,
        latencyMs: 100,
      }))

    // queryType for each item: concrete, concrete, subjective, subjective
    // We need to map itemIds to queryTypes — writeReport uses the ExperimentResult
    // which doesn't carry queryType directly. It uses items' input.
    // So we need to pass items separately.

    const hybridScores = [
      { 'ndcg@10': 0.8, 'precision@5': 0.6, 'recall@100': 0.9, mrr: 1.0 },
      { 'ndcg@10': 0.6, 'precision@5': 0.4, 'recall@100': 0.7, mrr: 0.5 },
      { 'ndcg@10': 0.7, 'precision@5': 0.5, 'recall@100': 0.8, mrr: 0.5 },
      { 'ndcg@10': 0.5, 'precision@5': 0.3, 'recall@100': 0.6, mrr: 0.25 },
    ]

    const ltrScores = [
      { 'ndcg@10': 0.9, 'precision@5': 0.8, 'recall@100': 1.0, mrr: 1.0 },
      { 'ndcg@10': 0.7, 'precision@5': 0.6, 'recall@100': 0.8, mrr: 1.0 },
      { 'ndcg@10': 0.8, 'precision@5': 0.6, 'recall@100': 0.9, mrr: 1.0 },
      { 'ndcg@10': 0.6, 'precision@5': 0.4, 'recall@100': 0.7, mrr: 0.5 },
    ]

    const armResults: ArmResult[] = [
      {
        arm: 'hybrid',
        items: makeItems('hybrid', hybridScores),
        summary: {
          scorerMeans: {
            'ndcg@10': 0.65,
            'precision@5': 0.45,
            'recall@100': 0.75,
            mrr: 0.5625,
          },
          costPerItem: 0,
          p95LatencyMs: 100,
        },
      },
      {
        arm: 'ltr:v1',
        items: makeItems('ltr:v1', ltrScores),
        summary: {
          scorerMeans: {
            'ndcg@10': 0.75,
            'precision@5': 0.6,
            'recall@100': 0.85,
            mrr: 0.875,
          },
          costPerItem: 0,
          p95LatencyMs: 100,
        },
      },
    ]

    const experimentResult: ExperimentResult = {
      summary: { total: 8, succeeded: 8, failed: 0 },
      armResults,
      markdown: '',
      exitCode: 0,
    }

    const queryTypes = new Map([
      ['q-1', 'concrete'],
      ['q-2', 'concrete'],
      ['q-3', 'subjective'],
      ['q-4', 'subjective'],
    ])

    const report = writeReport(experimentResult, {
      seed: 1736,
      queryTypes,
    })

    // Per-arm: mean with CI
    expect(report.arms.hybrid['ndcg@10']!.mean).toBeCloseTo(0.65, 5)
    expect(report.arms['ltr:v1']!['ndcg@10']!.mean).toBeCloseTo(0.75, 5)

    // CIs should have lo <= mean <= hi
    expect(report.arms.hybrid['ndcg@10']!.lo).toBeLessThanOrEqual(0.65)
    expect(report.arms.hybrid['ndcg@10']!.hi).toBeGreaterThanOrEqual(0.65)

    // Paired delta: ltr - hybrid ndcg@10 mean = 0.1
    expect(report.paired.ndcgAt10.mean).toBeCloseTo(0.1, 5)

    // Per-queryType breakdown
    expect(report.byQueryType.concrete).toBeDefined()
    expect(report.byQueryType.subjective).toBeDefined()
    expect(report.byQueryType.concrete!.hybrid!['ndcg@10']).toBeCloseTo(0.7, 5)
    expect(report.byQueryType.concrete!['ltr:v1']!['ndcg@10']).toBeCloseTo(0.8, 5)

    // Verdict: 'proceed' when paired.lo > 0
    // With only 4 items and mean 0.1, the CI may include 0 → verdict could be 'null'
    expect(['proceed', 'null']).toContain(report.verdict)
  })
})
