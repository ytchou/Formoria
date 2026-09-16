import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { getLangfuse, flushLangfuse } from '@/lib/langfuse/client'
import {
  LABELS_DIR,
  QUERIES_PATH,
  JUDGED_PAIRS_PATH,
  HAND_LABEL_SHEET_PATH,
  AGREEMENT_PATH,
  DATASET_V2_PATH,
  splitByQuery,
  fromCsv,
  type JudgedPair,
} from './label-shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DatasetItem = {
  id: string
  queryId: string
  query: string
  brandSlug: string
  productKey: string
  grade: number
  gradeSource: 'human' | 'llm'
  votes: number[]
  split: 'train' | 'val' | 'holdout'
  humanApproval: boolean
  category?: string
}

// ---------------------------------------------------------------------------
// cmdBuildDataset
// ---------------------------------------------------------------------------

export async function cmdBuildDataset(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log('Usage: pnpm search:eval build-dataset [--split 60/20/20] [--seed 1736]')
    console.log(
      '  Reads all labels, splits queries into train/val/holdout, uploads to Langfuse as situation-search-v2',
    )
    return
  }

  const splitStr = String(values.split ?? '60/20/20')
  const seed = parseInt(String(values.seed ?? '1736'), 10)

  const splitParts = splitStr.split('/').map(Number)
  if (splitParts.length !== 3 || splitParts.some(n => Number.isNaN(n))) {
    console.error('[build-dataset] Invalid split format. Use --split 60/20/20')
    process.exitCode = 1
    return
  }
  const ratios: [number, number, number] = [splitParts[0]!, splitParts[1]!, splitParts[2]!]

  mkdirSync(LABELS_DIR, { recursive: true })

  if (!existsSync(JUDGED_PAIRS_PATH)) {
    console.error('[build-dataset] No judged-pairs.json found. Run judge first.')
    process.exitCode = 1
    return
  }

  const judgedPairs: JudgedPair[] = JSON.parse(readFileSync(JUDGED_PAIRS_PATH, 'utf8'))
  const queries: Array<{ id: string; query: string; category?: string }> = existsSync(QUERIES_PATH)
    ? JSON.parse(readFileSync(QUERIES_PATH, 'utf8'))
    : []

  const queryMap = new Map(queries.map(q => [q.id, q]))

  // Load hand-label sheet for human overrides
  const humanGrades = new Map<string, number>()
  if (existsSync(HAND_LABEL_SHEET_PATH)) {
    const rows = fromCsv(readFileSync(HAND_LABEL_SHEET_PATH, 'utf8'))
    for (const row of rows) {
      if (row.human_grade !== '') {
        const grade = parseInt(row.human_grade, 10)
        if (!Number.isNaN(grade) && grade >= 0 && grade <= 3) {
          const key = `${row.query_id}|${row.brand_slug}|${row.product_key}`
          humanGrades.set(key, grade)
        }
      }
    }
    console.log(`[build-dataset] Loaded ${humanGrades.size} human grades`)
  }

  // Load agreement for humanApproval stamp
  let humanApproval = false
  if (existsSync(AGREEMENT_PATH)) {
    const agreement = JSON.parse(readFileSync(AGREEMENT_PATH, 'utf8'))
    humanApproval = typeof agreement.kappa_w === 'number' && agreement.kappa_w >= 0.6
    console.log(
      `[build-dataset] Agreement kappa_w=${agreement.kappa_w?.toFixed(4)}, humanApproval=${humanApproval}`,
    )
  }

  // Filter out pairs with empty votes
  let droppedCount = 0
  const validPairs = judgedPairs.filter(p => {
    if (p.votes.length === 0) {
      droppedCount++
      return false
    }
    return true
  })
  if (droppedCount > 0) {
    console.log(`[build-dataset] Dropped ${droppedCount} pairs with empty votes`)
  }

  // Resolve grades: human > majority
  const items: Array<{
    queryId: string
    query: string
    brandSlug: string
    productKey: string
    grade: number
    gradeSource: 'human' | 'llm'
    votes: number[]
    category?: string
  }> = validPairs.map(p => {
    const key = `${p.queryId}|${p.brandSlug}|${p.productKey}`
    const humanGrade = humanGrades.get(key)
    return {
      queryId: p.queryId,
      query: p.query,
      brandSlug: p.brandSlug,
      productKey: p.productKey,
      grade: humanGrade !== undefined ? humanGrade : p.grade,
      gradeSource: humanGrade !== undefined ? 'human' as const : 'llm' as const,
      votes: p.votes,
      category: p.categoryZh ?? queryMap.get(p.queryId)?.category,
    }
  })

  // Split by query
  const uniqueQueries = [...new Map(items.map(i => [i.queryId, { id: i.queryId, category: i.category }])).values()]
  const splits = splitByQuery(uniqueQueries, ratios, seed)

  const querySplitMap = new Map<string, 'train' | 'val' | 'holdout'>()
  for (const q of splits.train) querySplitMap.set(q.id, 'train')
  for (const q of splits.val) querySplitMap.set(q.id, 'val')
  for (const q of splits.holdout) querySplitMap.set(q.id, 'holdout')

  // Build dataset
  const dataset: DatasetItem[] = items.map(item => ({
    id: `${item.queryId}:${item.brandSlug}:${item.productKey}`,
    queryId: item.queryId,
    query: item.query,
    brandSlug: item.brandSlug,
    productKey: item.productKey,
    grade: item.grade,
    gradeSource: item.gradeSource,
    votes: item.votes,
    split: querySplitMap.get(item.queryId) ?? 'train',
    humanApproval,
    ...(item.category ? { category: item.category } : {}),
  }))

  // Write local file first
  writeFileSync(DATASET_V2_PATH, JSON.stringify(dataset, null, 2))
  console.log(`[build-dataset] Wrote ${dataset.length} items to ${DATASET_V2_PATH}`)

  // Summary
  const trainCount = dataset.filter(d => d.split === 'train').length
  const valCount = dataset.filter(d => d.split === 'val').length
  const holdoutCount = dataset.filter(d => d.split === 'holdout').length
  const humanCount = dataset.filter(d => d.gradeSource === 'human').length
  console.log(`  train=${trainCount} val=${valCount} holdout=${holdoutCount}`)
  console.log(`  humanGrades=${humanCount} humanApproval=${humanApproval}`)

  // Mirror to Langfuse
  const langfuse = getLangfuse()
  if (langfuse) {
    console.log('[build-dataset] Uploading to Langfuse dataset situation-search-v2...')
    try {
      for (const item of dataset) {
        await langfuse.createDatasetItem({
          datasetName: 'situation-search-v2',
          id: item.id,
          input: {
            query: item.query,
            category: item.category ?? null,
          },
          expectedOutput: {
            brandSlug: item.brandSlug,
            productKey: item.productKey,
            grade: item.grade,
          },
          metadata: {
            split: item.split,
            gradeSource: item.gradeSource,
            votes: item.votes,
            humanApproval: item.humanApproval,
          },
        })
      }
      await flushLangfuse()
      console.log('[build-dataset] Langfuse upload complete')
    } catch (err) {
      console.warn(
        '[build-dataset] Langfuse upload failed (local file written):',
        err instanceof Error ? err.message : err,
      )
    }
  } else {
    console.log('[build-dataset] Langfuse not configured, skipping upload')
  }
}
