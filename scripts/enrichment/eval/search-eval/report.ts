/**
 * Report generation for retrieval evaluation experiments.
 * Extracted from retrieval-eval.ts so it can be imported without pulling in
 * the full script and its staging-only subcommands.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  bootstrapCI,
  pairedBootstrapCI,
  mean,
} from '@/lib/services/eval/scorers'
import type { ExperimentResult } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type ReportOutput = {
  timestamp: string
  arms: Record<string, Record<string, { lo: number; hi: number; mean: number }>>
  paired: { ndcgAt10: { lo: number; hi: number; mean: number; signTestP: number } }
  byQueryType: Record<string, Record<string, Record<string, number>>>
  verdict: 'proceed' | 'null'
}

// ---------------------------------------------------------------------------
// writeReport
// ---------------------------------------------------------------------------

export function writeReport(
  result: ExperimentResult,
  opts: {
    seed: number
    out?: string
    queryTypes?: Map<string, string>
  },
): ReportOutput {
  const metricNames = ['ndcg@10', 'precision@5', 'recall@100', 'mrr']

  // Per-arm CIs
  const arms: ReportOutput['arms'] = {}
  for (const ar of result.armResults) {
    const armCis: Record<string, { lo: number; hi: number; mean: number }> = {}
    for (const metric of metricNames) {
      const values = ar.items.map((i) => i.scores[metric] ?? 0)
      armCis[metric] = bootstrapCI(values, 1000, 0.05, { seed: opts.seed })
    }
    arms[ar.arm] = armCis
  }

  // Paired NDCG@10 delta between first two arms
  let paired: ReportOutput['paired'] = {
    ndcgAt10: { lo: 0, hi: 0, mean: 0, signTestP: 1 },
  }
  if (result.armResults.length >= 2) {
    const a = result.armResults[0]!
    const b = result.armResults[1]!
    const aScores = a.items.map((i) => i.scores['ndcg@10'] ?? 0)
    const bScores = b.items.map((i) => i.scores['ndcg@10'] ?? 0)
    // Delta: second arm - first arm (improvement of arm B over arm A)
    paired = {
      ndcgAt10: pairedBootstrapCI(bScores, aScores, {
        nBoot: 1000,
        seed: opts.seed,
      }),
    }
  }

  // Per-queryType breakdown
  const byQueryType: ReportOutput['byQueryType'] = {}
  if (opts.queryTypes && opts.queryTypes.size > 0) {
    const queryTypeSet = new Set(opts.queryTypes.values())
    for (const qt of queryTypeSet) {
      byQueryType[qt] = {}
      for (const ar of result.armResults) {
        const filtered = ar.items.filter(
          (i) => opts.queryTypes!.get(i.itemId) === qt,
        )
        const armMeans: Record<string, number> = {}
        for (const metric of metricNames) {
          armMeans[metric] = mean(filtered.map((i) => i.scores[metric] ?? 0))
        }
        byQueryType[qt]![ar.arm] = armMeans
      }
    }
  }

  // Verdict
  const verdict: ReportOutput['verdict'] = paired.ndcgAt10.lo > 0 ? 'proceed' : 'null'

  const report: ReportOutput = {
    timestamp: new Date().toISOString(),
    arms,
    paired,
    byQueryType,
    verdict,
  }

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true })
    writeFileSync(opts.out, JSON.stringify(report, null, 2))
  }

  return report
}
