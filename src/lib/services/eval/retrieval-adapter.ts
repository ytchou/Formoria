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
    category?: string | null
    enableIntentParse?: boolean
  }) => Promise<{ products: Array<{ id: string; key: string; brandSlug: string }> }>
  category?: (opts: {
    category: string
    pageSize?: number
  }) => Promise<{ products: Array<{ id: string; key: string; brandSlug: string }> }>
  rerank?: (
    query: string,
    candidates: Array<{ id: string; document: string }>,
  ) => Promise<Array<{ id: string }>>
  rank?: (opts: {
    query: string
    version: string
    category?: string | null
  }) => Promise<string[]>
}

// ---------------------------------------------------------------------------
// Composite key helper
// ---------------------------------------------------------------------------

export function compositeKey(p: { brandSlug: string; key: string }): string {
  return `${p.brandSlug}/${p.key}`
}

// ---------------------------------------------------------------------------
// Scorer helpers — precision/recall/mrr need string[] expected, not GradedItem[]
// ---------------------------------------------------------------------------

function gradedKeys(expected: unknown): string[] {
  return (expected as GradedItem[]).filter((g) => g.grade > 0).map((g) => g.key)
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
    expectedSchema: z.array(z.object({ key: z.string().regex(/\//), grade: z.number() })),
    scorers: [
      { name: 'ndcg@10', fn: ndcgAt(10) },
      {
        name: 'precision@5',
        fn: (output: unknown, expected: unknown): number =>
          precisionAtK(output as string[], gradedKeys(expected), 5),
      },
      {
        name: 'recall@100',
        fn: (output: unknown, expected: unknown): number =>
          recallAtK(output as string[], gradedKeys(expected), 100),
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
      const input = item.input as { query: string; locale?: 'zh-TW' | 'en'; category?: string }
      const locale = input.locale ?? 'zh-TW'

      // Parse arm value
      const ltrMatch = arm.value.match(/^ltr:(.+)$/)

      if (ltrMatch) {
        // LTR arm
        if (!deps.rank) throw new Error(`rank dep required for arm "${arm.value}"`)
        const keys = await deps.rank({
          query: input.query,
          version: ltrMatch[1]!,
          category: input.category ?? null,
        })
        return { ok: true, output: keys }
      }

      if (arm.value === 'category') {
        if (!deps.category || !input.category) return { ok: true, output: [] }
        const result = await deps.category({
          category: input.category,
          pageSize: 100,
        })
        return { ok: true, output: result.products.map(compositeKey) }
      }

      if (arm.value === 'rerank') {
        const result = await deps.search({
          query: input.query,
          locale,
          mode: 'hybrid',
          pageSize: 20,
          category: input.category ?? null,
          enableIntentParse: false,
        })
        if (!deps.rerank) {
          return { ok: true, output: result.products.map(compositeKey) }
        }
        const candidates = result.products.map((p) => ({
          id: p.id,
          document: `${(p as Record<string, unknown>).nameZh ?? ''} ${(p as Record<string, unknown>).category ?? ''} ${(p as Record<string, unknown>).subcategory ?? ''}`,
        }))
        const reranked = await deps.rerank(input.query, candidates)
        const byId = new Map(result.products.map((p) => [p.id, p]))
        return {
          ok: true,
          output: reranked
            .map((r) => {
              const p = byId.get(r.id)
              return p ? compositeKey(p) : ''
            })
            .filter(Boolean),
        }
      }

      // hybrid / vector / lexical
      const mode = arm.value as SearchMode
      const result = await deps.search({
        query: input.query,
        locale,
        mode,
        pageSize: 100,
        category: input.category ?? null,
        enableIntentParse: false,
      })
      return { ok: true, output: result.products.map(compositeKey) }
    },
  }
}
