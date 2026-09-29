import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { searchProductsBySituation, type LexicalParams } from '@/lib/services/product-situation-search'
import { createRetrievalAdapter } from '@/lib/services/eval/retrieval-adapter'
import { runExperiment } from '@/lib/services/eval/run-experiment'
import { createScriptExperimentDeps } from '@/lib/services/eval/script-experiment-deps'

import { loadDatasetV2, resolveDataset, toExperimentItems, type DatasetV2Item } from './dataset-v2'

type SweepConfig = { id: string; params: LexicalParams }
type SweepResult = SweepConfig & {
  ndcgAt10: number
  mrr: number
  p95LatencyMs: number
  failed: number
  scoresByQuery: Record<string, { ndcgAt10: number; mrr: number }>
}

const WEIGHT_SETS = [
  [1, 0.6, 0.4, 0.2],
  [1, 0.8, 0.4, 0.2],
  [1, 0.6, 0.3, 0.1],
  [1, 1, 0.5, 0.25],
] as const

export function expandLexicalGrid(): SweepConfig[] {
  const configs: SweepConfig[] = []
  for (const [wA, wB, wC, wD] of WEIGHT_SETS) {
    const weightId = `w${wA}-${wB}-${wC}-${wD}`
    for (const k1 of [0.9, 1.2, 1.6]) {
      for (const b of [0.5, 0.75]) {
        configs.push({
          id: `bm25f-k${k1}-b${b}-${weightId}`,
          params: { scorer: 'bm25f', k1, b, wA, wB, wC, wD },
        })
      }
    }
    configs.push({ id: `tsrank-${weightId}`, params: { scorer: 'tsrank', wA, wB, wC, wD } })
  }
  return configs
}

export function sweepItems<T extends Pick<DatasetV2Item, 'split'>>(items: T[]): T[] {
  return items.filter(item => item.split === 'train' || item.split === 'val')
}

export function pickSweepWinner<T extends { id: string; ndcgAt10: number; mrr: number }>(results: T[]): T | undefined {
  return [...results].sort((a, b) => b.ndcgAt10 - a.ndcgAt10 || b.mrr - a.mrr || a.id.localeCompare(b.id)).at(0)
}

export async function cmdSweep(values: Record<string, unknown>): Promise<void> {
  if (values.help) {
    console.log('Usage: pnpm search:eval sweep [--dataset v3] [--out path]')
    return
  }

  const dataset = resolveDataset(values.dataset ? String(values.dataset) : 'v3')
  const items = toExperimentItems(sweepItems(loadDatasetV2(dataset.path)))
  if (items.length === 0) throw new Error('No train or validation queries in the dataset')
  const out = String(values.out ?? resolve(dirname(dataset.path), 'runs/dev-1900-sweep.json'))
  const results: SweepResult[] = []

  for (const config of expandLexicalGrid()) {
    const adapter = createRetrievalAdapter({
      search: input => searchProductsBySituation(input),
      lexicalParams: config.params,
    })
    const deps = await createScriptExperimentDeps({ adapter, profileKey: 'search-eval' })
    const run = await runExperiment({
      dataset: dataset.name,
      arms: [{ name: config.id, type: 'custom', value: `lexical:${config.params.scorer}` }],
      adapter,
      items,
      deps,
    })
    const arm = run.armResults[0]
    if (!arm) throw new Error(`Missing sweep result for ${config.id}`)
    const failed = arm.items.filter(item => !item.ok).length
    if (failed > 0) throw new Error(`${config.id} failed on ${failed} queries; refusing to select a winner`)
    results.push({
      ...config,
      ndcgAt10: arm.summary.scorerMeans['ndcg@10'] ?? 0,
      mrr: arm.summary.scorerMeans.mrr ?? 0,
      p95LatencyMs: arm.summary.p95LatencyMs,
      failed,
      scoresByQuery: Object.fromEntries(arm.items.map(item => [item.itemId, {
        ndcgAt10: item.scores['ndcg@10'] ?? 0,
        mrr: item.scores.mrr ?? 0,
      }])),
    })
    const winner = pickSweepWinner(results)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify({ dataset: dataset.name, splits: ['train', 'val'], queryCount: items.length, configs: results, winner: winner?.id }, null, 2))
    console.log(`[sweep] ${results.length}/28 ${config.id}: NDCG@10=${results.at(-1)!.ndcgAt10.toFixed(4)}`)
  }
}
