import { z } from 'zod'

import type { PhaseAdapter } from './phase-adapters'
import type { ExperimentItem, ExperimentArm } from './run-experiment'
import { ndcgAt, precisionAtK, recallAtK, mrr as mrrFn, type GradedItem } from './scorers'
import type { SearchMode } from '@/lib/services/product-situation-search'

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export type RetrievalAdapterDeps = {
  search: (input: {
    query: string
    locale: 'zh-TW' | 'en'
    mode: SearchMode
    pageSize: number
  }) => Promise<{ products: Array<{ key: string }> }>
}

// ---------------------------------------------------------------------------
// Scorer helpers — precision/recall/mrr need string[] expected, not GradedItem[]
// ---------------------------------------------------------------------------

function gradedKeys(expected: unknown): string[] {
  return (expected as GradedItem[]).map((g) => g.key)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRetrievalAdapter(deps: RetrievalAdapterDeps): PhaseAdapter {
  return {
    promptName: null,
    profileKey: 'search-eval',
    mode: 'scored',
    outputSchema: z.array(z.string()),
    requestSchema: { name: 'search-eval', schema: {} },
    parseOutput: () => ({ ok: true as const, data: null }),
    unwrap: (output) => output,
    expectedOf: (item) => item.expectedOutput as GradedItem[],
    expectedSchema: z.array(z.object({ key: z.string(), grade: z.number() })),
    scorers: [
      { name: 'ndcg@10', fn: ndcgAt(10) },
      {
        name: 'precision@5',
        fn: (output: unknown, expected: unknown): number =>
          precisionAtK(output as string[], gradedKeys(expected), 5),
      },
      {
        name: 'recall@5',
        fn: (output: unknown, expected: unknown): number =>
          recallAtK(output as string[], gradedKeys(expected), 5),
      },
      {
        name: 'mrr',
        fn: (output: unknown, expected: unknown): number =>
          mrrFn(output as string[], gradedKeys(expected)),
      },
    ],
    task: async (
      item: ExperimentItem,
      arm: ExperimentArm,
      _ctx: { itemRunId: string; model?: string },
    ) => {
      const input = item.input as { query: string; locale: 'zh-TW' | 'en' }
      const result = await deps.search({
        query: input.query,
        locale: input.locale,
        mode: arm.value as SearchMode,
        pageSize: 100,
      })
      const keys = result.products.map((p) => p.key)
      return { ok: true, output: keys }
    },
  }
}
