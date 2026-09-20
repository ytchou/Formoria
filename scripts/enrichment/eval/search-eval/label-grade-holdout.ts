import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

import { searchProductsBySituation } from '@/lib/services/product-situation-search'
import { buildRerankDocument, rerankProducts } from '@/lib/services/product-rerank'
import { compositeKey } from '@/lib/services/eval/retrieval-adapter'
import { loadDatasetV2, type DatasetV2Item } from './dataset-v2'
import { HOLDOUT_GRADES_PATH, escapeCsvField, parseCsvLine } from './label-shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)

type GradeRow = {
  query_id: string
  query: string
  brand_slug: string
  product_key: string
  name_zh: string
  description_zh: string
  official_url: string
  llm_grade: string
  hybrid_rank: string
  rerank_rank: string
  disagreement: string
  human_grade: string
}

const CSV_COLUMNS: (keyof GradeRow)[] = [
  'query_id', 'query', 'brand_slug', 'product_key',
  'name_zh', 'description_zh', 'official_url', 'llm_grade',
  'hybrid_rank', 'rerank_rank', 'disagreement', 'human_grade',
]

// ---------------------------------------------------------------------------
// export-grades
// ---------------------------------------------------------------------------

export async function cmdExportGrades(values: Record<string, unknown>) {
  const armSpecs = String(values.arm ?? 'hybrid,rerank').split(',')
  const k = parseInt(String(values.k ?? '10'), 10)
  const outPath = values.out ? String(values.out) : HOLDOUT_GRADES_PATH

  const datasetPath = resolve(SCRIPT_DIR, 'situation-search-v2.json')
  const items = loadDatasetV2(datasetPath, { split: 'holdout' })

  const gradeLookup = new Map<string, number>()
  for (const item of items) {
    for (const e of item.expected) {
      gradeLookup.set(`${e.brandSlug}/${e.productKey}`, e.grade)
    }
  }

  const allRows: GradeRow[] = []

  for (let qi = 0; qi < items.length; qi++) {
    const item = items[qi]!
    console.log(`[export-grades] query ${qi + 1}/${items.length}: ${item.id}`)

    const result = await searchProductsBySituation({
      query: item.query,
      locale: 'zh-TW',
      mode: 'hybrid',
      pageSize: 100,
      category: item.category ?? null,
      enableIntentParse: false,
    })

    const products = result.products
    const productMeta = new Map<string, { nameZh: string; descriptionZh: string; officialUrl: string }>()
    for (const p of products) {
      productMeta.set(compositeKey(p), {
        nameZh: p.nameZh,
        descriptionZh: p.productDescriptionZh,
        officialUrl: p.officialUrl ?? '',
      })
    }

    const candidates = products.map((p) => ({
      id: p.id,
      document: buildRerankDocument(p),
    }))
    const byId = new Map(products.map((p) => [p.id, p]))

    const rankings = new Map<string, string[]>()

    for (const arm of armSpecs) {
      let ranked: string[]
      if (arm === 'hybrid') {
        ranked = products.map((p) => compositeKey(p))
      } else if (arm === 'rerank') {
        const reranked = await rerankProducts(item.query, candidates)
        ranked = reranked
          .map((r) => {
            const p = byId.get(r.id)
            return p ? compositeKey(p) : ''
          })
          .filter(Boolean)
      } else {
        throw new Error(`Unknown arm: "${arm}"`)
      }
      rankings.set(arm, ranked)
    }

    // Collect union of top-K across all arms
    const topKUnion = new Set<string>()
    for (const [, ranked] of rankings) {
      for (let i = 0; i < Math.min(k, ranked.length); i++) {
        topKUnion.add(ranked[i]!)
      }
    }

    for (const ckey of topKUnion) {
      const [brandSlug, ...rest] = ckey.split('/')
      const productKey = rest.join('/')
      const meta = productMeta.get(ckey)

      const ranks: number[] = []
      const rankStrs: Record<string, string> = {}
      for (const arm of armSpecs) {
        const ranked = rankings.get(arm)!
        const idx = ranked.indexOf(ckey)
        const rank1 = idx >= 0 && idx < k ? idx + 1 : -1
        if (rank1 > 0) ranks.push(rank1)
        const armKey = arm === 'hybrid' ? 'hybrid_rank'
          : arm === 'rerank' ? 'rerank_rank'
          : arm
        rankStrs[armKey] = rank1 > 0 ? String(rank1) : ''
      }

      const disagreement = ranks.length >= 2
        ? Math.max(...ranks) - Math.min(...ranks)
        : 0

      allRows.push({
        query_id: item.id,
        query: item.query,
        brand_slug: brandSlug!,
        product_key: productKey,
        name_zh: meta?.nameZh ?? '',
        description_zh: meta?.descriptionZh ?? '',
        official_url: meta?.officialUrl ?? '',
        llm_grade: gradeLookup.has(ckey) ? String(gradeLookup.get(ckey)) : '',
        hybrid_rank: rankStrs['hybrid_rank'] ?? '',
        rerank_rank: rankStrs['rerank_rank'] ?? '',
        disagreement: String(disagreement),
        human_grade: '',
      })
    }
  }

  // Sort by disagreement desc, then average rank asc
  allRows.sort((a, b) => {
    const dA = parseInt(a.disagreement) || 0
    const dB = parseInt(b.disagreement) || 0
    if (dB !== dA) return dB - dA
    const avgA = avgRank(a)
    const avgB = avgRank(b)
    return avgA - avgB
  })

  const header = CSV_COLUMNS.join(',')
  const lines = allRows.map((row) =>
    CSV_COLUMNS.map((col) => escapeCsvField(String(row[col]))).join(','),
  )
  writeFileSync(outPath, [header, ...lines].join('\n'))
  console.log(`[export-grades] wrote ${allRows.length} rows to ${outPath}`)
}

function avgRank(row: GradeRow): number {
  const vals = [row.hybrid_rank, row.rerank_rank]
    .filter((v) => v !== '')
    .map(Number)
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : Infinity
}

// ---------------------------------------------------------------------------
// apply-grades
// ---------------------------------------------------------------------------

export async function cmdApplyGrades(values: Record<string, unknown>) {
  const csvPath = values.csv ? String(values.csv) : HOLDOUT_GRADES_PATH
  const csv = readFileSync(csvPath, 'utf8')
  const lines = csv.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    console.log('[apply-grades] no data rows in CSV')
    return
  }

  const headerFields = parseCsvLine(lines[0]!)
  const gradeColIdx = headerFields.indexOf('human_grade')
  const queryIdIdx = headerFields.indexOf('query_id')
  const brandSlugIdx = headerFields.indexOf('brand_slug')
  const productKeyIdx = headerFields.indexOf('product_key')

  if (gradeColIdx < 0 || queryIdIdx < 0 || brandSlugIdx < 0 || productKeyIdx < 0) {
    throw new Error('CSV missing required columns: query_id, brand_slug, product_key, human_grade')
  }

  const graded: Array<{ queryId: string; brandSlug: string; productKey: string; grade: number }> = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!)
    const humanGrade = fields[gradeColIdx] ?? ''
    if (humanGrade === '') continue
    graded.push({
      queryId: fields[queryIdIdx]!,
      brandSlug: fields[brandSlugIdx]!,
      productKey: fields[productKeyIdx]!,
      grade: parseInt(humanGrade, 10),
    })
  }

  if (graded.length === 0) {
    console.log('[apply-grades] no rows with human_grade — nothing to apply')
    return
  }

  const datasetPaths = [
    resolve(SCRIPT_DIR, 'situation-search-v2.json'),
    resolve(SCRIPT_DIR, 'labels', 'situation-search-v2.json'),
  ]

  const today = new Date().toISOString().slice(0, 10)
  let updated = 0
  let added = 0

  for (const dsPath of datasetPaths) {
    const dataset: DatasetV2Item[] = JSON.parse(readFileSync(dsPath, 'utf8'))
    const byId = new Map(dataset.map((q) => [q.id, q]))
    const affectedQueries = new Set<string>()

    for (const g of graded) {
      const query = byId.get(g.queryId)
      if (!query) continue

      const existing = query.expected.find(
        (e) => e.brandSlug === g.brandSlug && e.productKey === g.productKey,
      )
      if (existing) {
        if (dsPath === datasetPaths[0]) updated++
        existing.grade = g.grade
      } else {
        if (dsPath === datasetPaths[0]) added++
        query.expected.push({
          brandSlug: g.brandSlug,
          productKey: g.productKey,
          grade: g.grade,
        })
      }
      affectedQueries.add(g.queryId)
    }

    for (const qId of affectedQueries) {
      const query = byId.get(qId)!
      query.humanApproval = { reviewedVia: 'human-override', at: today }
    }

    writeFileSync(dsPath, JSON.stringify(dataset, null, 2))
  }

  console.log(`[apply-grades] ${updated} updated, ${added} added, ${graded.length} total graded rows`)
}
