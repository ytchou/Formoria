import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { ExperimentItem } from '@/lib/services/eval/run-experiment'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetV2Item = {
  id: string
  query: string
  category?: string | null
  queryType?: 'concrete' | 'subjective' | 'brand_name' | 'keyword' | 'english'
  split: 'train' | 'val' | 'holdout'
  expected: Array<{ brandSlug: string; productKey: string; grade: number }>
  humanApproval?: { reviewedVia: string; at: string }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export type DatasetVersion = 'v2' | 'v3'

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)

export function resolveDataset(version?: string): { version: DatasetVersion; name: string; path: string } {
  const selected = version ?? (existsSync(resolve(SCRIPT_DIR, 'situation-search-v3.json')) ? 'v3' : 'v2')
  if (selected !== 'v2' && selected !== 'v3') {
    throw new Error(`Unknown dataset: ${selected}; expected v2 or v3`)
  }
  const name = `situation-search-${selected}`
  return { version: selected, name, path: resolve(SCRIPT_DIR, `${name}.json`) }
}

export function loadDatasetV2(
  path: string,
  opts: { split?: string } = {},
): DatasetV2Item[] {
  const raw: DatasetV2Item[] = JSON.parse(readFileSync(path, 'utf8'))
  const queryTypes = new Set(['concrete', 'subjective', 'brand_name', 'keyword', 'english'])

  // Duplicate id check
  const ids = new Set<string>()
  for (const item of raw) {
    if (ids.has(item.id)) throw new Error(`Duplicate query id: ${item.id}`)
    if (item.queryType && !queryTypes.has(item.queryType)) {
      throw new Error(`Unknown queryType for ${item.id}: ${item.queryType}`)
    }
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
