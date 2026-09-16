import { readFileSync } from 'node:fs'

import type { ExperimentItem } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetV2Item = {
  id: string
  query: string
  category?: string | null
  queryType?: 'concrete' | 'subjective'
  split: 'train' | 'val' | 'holdout'
  expected: Array<{ brandSlug: string; productKey: string; grade: number }>
  humanApproval?: { reviewedVia: string; at: string }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadDatasetV2(
  path: string,
  opts: { split?: string } = {},
): DatasetV2Item[] {
  const raw: DatasetV2Item[] = JSON.parse(readFileSync(path, 'utf8'))

  // Duplicate id check
  const ids = new Set<string>()
  for (const item of raw) {
    if (ids.has(item.id)) throw new Error(`Duplicate query id: ${item.id}`)
    ids.add(item.id)
  }

  if (opts.split) {
    return raw.filter((item) => item.split === opts.split)
  }
  return raw
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

export function toExperimentItems(items: DatasetV2Item[]): ExperimentItem[] {
  return items.map((item) => ({
    id: item.id,
    input: {
      query: item.query,
      category: item.category ?? null,
      queryType: item.queryType,
    },
    expectedOutput: item.expected.map((e) => ({
      key: `${e.brandSlug}/${e.productKey}`,
      grade: e.grade,
    })),
    humanApproval: item.humanApproval ?? {},
  }))
}
