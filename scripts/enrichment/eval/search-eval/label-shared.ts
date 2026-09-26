import { resolve, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// File path constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
export const LABELS_DIR = resolve(SCRIPT_DIR, 'labels')
export const QUERIES_PATH = resolve(LABELS_DIR, 'queries.json')
export const CANDIDATES_PATH = resolve(LABELS_DIR, 'candidates.json')
export const JUDGED_PAIRS_PATH = resolve(LABELS_DIR, 'judged-pairs.json')
/** `judge --judge jev` output; kept apart so it never overwrites the OpenAI labels. */
export const JEV_JUDGED_PAIRS_PATH = resolve(LABELS_DIR, 'judged-pairs.jev.json')
export const HAND_LABEL_SHEET_PATH = resolve(LABELS_DIR, 'hand-label-sheet.csv')
export const AGREEMENT_PATH = resolve(LABELS_DIR, 'agreement.json')
export const DATASET_V2_PATH = resolve(LABELS_DIR, 'situation-search-v2.json')
export const HOLDOUT_GRADES_PATH = resolve(LABELS_DIR, 'holdout-grades.csv')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JudgedPair = {
  queryId: string
  query: string
  brandSlug: string
  productKey: string
  nameZh: string
  descriptionZh: string
  officialUrl: string
  categoryZh?: string
  votes: number[]
  grade: number
  split: boolean
  /** Jev arm only: probability per grade level, keyed '0'..'3'. */
  probabilities?: Record<string, number>
}

export type SheetRow = {
  query_id: string
  query: string
  brand_slug: string
  product_key: string
  name_zh: string
  description_zh: string
  official_url: string
  llm_grade: number
  human_grade: string
}

// ---------------------------------------------------------------------------
// Seeded PRNG (LCG)
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let state = seed
  return () => {
    // Numerical Recipes LCG
    state = (state * 1664525 + 1013904223) & 0x7fffffff
    return state / 0x7fffffff
  }
}

// ---------------------------------------------------------------------------
// sampleDeep
// ---------------------------------------------------------------------------

/**
 * Returns `count` distinct ranks in `[minRank, poolSize]` deterministically
 * using a seeded PRNG.
 */
export function sampleDeep(
  seed: number,
  poolSize = 100,
  count = 5,
  minRank = 21,
): number[] {
  const rng = lcg(seed)
  const range = poolSize - minRank + 1
  const result = new Set<number>()
  // Safety cap to avoid infinite loop
  let attempts = 0
  while (result.size < count && attempts < count * 100) {
    const rank = minRank + Math.floor(rng() * range)
    result.add(rank)
    attempts++
  }
  return [...result]
}

// ---------------------------------------------------------------------------
// splitByQuery
// ---------------------------------------------------------------------------

type SplitItem = { id: string; category?: string }

type SplitResult<T extends SplitItem> = {
  train: T[]
  val: T[]
  holdout: T[]
}

/**
 * Assigns each query to train/val/holdout respecting category stratification.
 * Every query appears in exactly one split.
 */
export function splitByQuery<T extends SplitItem>(
  items: T[],
  ratios: [number, number, number],
  seed: number,
): SplitResult<T> {
  const rng = lcg(seed)
  const total = ratios[0] + ratios[1] + ratios[2]
  const trainRatio = ratios[0] / total
  const valRatio = ratios[1] / total

  // Group by category
  const byCategory = new Map<string, T[]>()
  for (const item of items) {
    const cat = item.category ?? '__none__'
    const arr = byCategory.get(cat) ?? []
    arr.push(item)
    byCategory.set(cat, arr)
  }

  const train: T[] = []
  const val: T[] = []
  const holdout: T[] = []

  // For each category, shuffle and split
  for (const [, categoryItems] of byCategory) {
    // Fisher-Yates shuffle with seeded rng
    const shuffled = [...categoryItems]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = tmp
    }

    const nTrain = Math.round(shuffled.length * trainRatio)
    const nVal = Math.round(shuffled.length * valRatio)

    for (let i = 0; i < shuffled.length; i++) {
      if (i < nTrain) {
        train.push(shuffled[i]!)
      } else if (i < nTrain + nVal) {
        val.push(shuffled[i]!)
      } else {
        holdout.push(shuffled[i]!)
      }
    }
  }

  return { train, val, holdout }
}

// ---------------------------------------------------------------------------
// cohenKappa
// ---------------------------------------------------------------------------

/**
 * Unweighted and quadratic-weighted Cohen's kappa from a confusion matrix.
 */
export function cohenKappa(
  matrix: number[][],
  weighted?: 'quadratic',
): number {
  const n = matrix.length
  const total = matrix.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0)
  if (total === 0) return 0

  // Row and column marginals
  const rowSums = matrix.map(row => row.reduce((a, b) => a + b, 0))
  const colSums = Array.from({ length: n }, (_, j) =>
    matrix.reduce((s, row) => s + row[j]!, 0),
  )

  if (!weighted) {
    // Unweighted kappa
    const po = matrix.reduce((s, row, i) => s + row[i]!, 0) / total
    const pe = rowSums.reduce((s, rs, i) => s + (rs * colSums[i]!) / (total * total), 0)
    return pe === 1 ? 1 : (po - pe) / (1 - pe)
  }

  // Quadratic-weighted kappa
  // w_{ij} = (i - j)^2 / (n - 1)^2
  const maxDist = (n - 1) * (n - 1)
  let po_w = 0
  let pe_w = 0

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = ((i - j) * (i - j)) / maxDist
      po_w += w * (matrix[i]![j]! / total)
      pe_w += w * ((rowSums[i]! * colSums[j]!) / (total * total))
    }
  }

  return pe_w === 0 ? 1 : 1 - po_w / pe_w
}

// ---------------------------------------------------------------------------
// stratifiedSheet
// ---------------------------------------------------------------------------

/**
 * Returns `count` pairs covering every grade and category, always including
 * split pairs. Merges with existingSheet by composite key (preserves
 * human_grade values).
 */
export function stratifiedSheet(
  judgedPairs: JudgedPair[],
  count: number,
  existingSheet?: SheetRow[],
): SheetRow[] {
  const rng = lcg(42)

  // Build existing human_grade lookup
  const existingGrades = new Map<string, string>()
  if (existingSheet) {
    for (const row of existingSheet) {
      const key = `${row.query_id}|${row.brand_slug}|${row.product_key}`
      if (row.human_grade !== '') {
        existingGrades.set(key, row.human_grade)
      }
    }
  }

  function toSheetRow(pair: JudgedPair): SheetRow {
    const key = `${pair.queryId}|${pair.brandSlug}|${pair.productKey}`
    return {
      query_id: pair.queryId,
      query: pair.query,
      brand_slug: pair.brandSlug,
      product_key: pair.productKey,
      name_zh: pair.nameZh,
      description_zh: pair.descriptionZh,
      official_url: pair.officialUrl,
      llm_grade: pair.grade,
      human_grade: existingGrades.get(key) ?? '',
    }
  }

  const selected = new Map<string, SheetRow>()

  // 1. Always include split pairs
  for (const pair of judgedPairs) {
    if (pair.split) {
      const key = `${pair.queryId}|${pair.brandSlug}|${pair.productKey}`
      selected.set(key, toSheetRow(pair))
    }
  }

  // 2. Ensure every grade is represented
  const gradeGroups = new Map<number, JudgedPair[]>()
  for (const pair of judgedPairs) {
    const arr = gradeGroups.get(pair.grade) ?? []
    arr.push(pair)
    gradeGroups.set(pair.grade, arr)
  }
  for (const [, pairs] of gradeGroups) {
    if (pairs.length > 0) {
      const pick = pairs[Math.floor(rng() * pairs.length)]!
      const key = `${pick.queryId}|${pick.brandSlug}|${pick.productKey}`
      if (!selected.has(key)) {
        selected.set(key, toSheetRow(pick))
      }
    }
  }

  // 3. Ensure every category is represented
  const catGroups = new Map<string, JudgedPair[]>()
  for (const pair of judgedPairs) {
    const cat = pair.categoryZh ?? '__none__'
    const arr = catGroups.get(cat) ?? []
    arr.push(pair)
    catGroups.set(cat, arr)
  }
  for (const [, pairs] of catGroups) {
    if (pairs.length > 0) {
      const pick = pairs[Math.floor(rng() * pairs.length)]!
      const key = `${pick.queryId}|${pick.brandSlug}|${pick.productKey}`
      if (!selected.has(key)) {
        selected.set(key, toSheetRow(pick))
      }
    }
  }

  // 4. Fill remaining from shuffled pool
  const remaining = judgedPairs.filter(p => {
    const key = `${p.queryId}|${p.brandSlug}|${p.productKey}`
    return !selected.has(key)
  })

  // Shuffle remaining
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = remaining[i]!
    remaining[i] = remaining[j]!
    remaining[j] = tmp
  }

  for (const pair of remaining) {
    if (selected.size >= count) break
    const key = `${pair.queryId}|${pair.brandSlug}|${pair.productKey}`
    selected.set(key, toSheetRow(pair))
  }

  return [...selected.values()]
}

// ---------------------------------------------------------------------------
// CSV round-trip
// ---------------------------------------------------------------------------

const SHEET_COLUMNS: (keyof SheetRow)[] = [
  'query_id', 'query', 'brand_slug', 'product_key',
  'name_zh', 'description_zh', 'official_url', 'llm_grade', 'human_grade',
]

export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i <= line.length) {
    if (i === line.length) {
      fields.push('')
      break
    }
    if (line[i] === '"') {
      // Quoted field
      let value = ''
      i++ // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            value += '"'
            i += 2
          } else {
            i++ // skip closing quote
            break
          }
        } else {
          value += line[i]
          i++
        }
      }
      fields.push(value)
      if (i < line.length && line[i] === ',') i++ // skip comma
    } else {
      // Unquoted field
      const commaIdx = line.indexOf(',', i)
      if (commaIdx === -1) {
        fields.push(line.slice(i))
        break
      } else {
        fields.push(line.slice(i, commaIdx))
        i = commaIdx + 1
      }
    }
  }
  return fields
}

export function toCsv(rows: SheetRow[]): string {
  const header = SHEET_COLUMNS.join(',')
  const lines = rows.map(row =>
    SHEET_COLUMNS.map(col => escapeCsvField(String(row[col]))).join(','),
  )
  return [header, ...lines].join('\n')
}

export function fromCsv(csv: string): SheetRow[] {
  const lines = csv.split('\n').filter(l => l.trim() !== '')
  if (lines.length < 2) return []

  const _header = lines[0] // skip header
  return lines.slice(1).map(line => {
    const fields = parseCsvLine(line)
    return {
      query_id: fields[0] ?? '',
      query: fields[1] ?? '',
      brand_slug: fields[2] ?? '',
      product_key: fields[3] ?? '',
      name_zh: fields[4] ?? '',
      description_zh: fields[5] ?? '',
      official_url: fields[6] ?? '',
      llm_grade: parseInt(fields[7] ?? '0', 10),
      human_grade: fields[8] ?? '',
    }
  })
}
