// Prevent LTR reranking from contaminating eval/training data — the env var
// is read at call time inside searchProductsBySituation, not at module load.
process.env.SEARCH_LTR_MODE = 'off';

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'

import {
  searchProductsBySituation,
} from '@/lib/services/product-situation-search'
import { getPublishedCuratedProducts } from '@/lib/services/curated-products-catalog'
import { judgeRelevance } from '@/lib/services/eval/search-relevance-judge'
import { fetchLangfusePromptWithMeta } from '@/lib/langfuse/prompt'
import {
  LABELS_DIR,
  QUERIES_PATH,
  CANDIDATES_PATH,
  JUDGED_PAIRS_PATH,
  HAND_LABEL_SHEET_PATH,
  sampleDeep,
  stratifiedSheet,
  toCsv,
  fromCsv,
  type JudgedPair,
} from './label-shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Query = {
  id: string
  query: string
  category?: string
  source: string
}

type Candidate = {
  queryId: string
  brandSlug: string
  productKey: string
  productId: string
  rrfRank: number
  searchSource: string
}

// ---------------------------------------------------------------------------
// cmdRetrieveCandidates
// ---------------------------------------------------------------------------

export async function cmdRetrieveCandidates(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      'Usage: pnpm search:eval retrieve-candidates [--pageSize 100]',
    )
    console.log(
      '  For each query, call searchProductsBySituation and write candidate pairs',
    )
    return
  }

  const pageSize = parseInt(String(values.pageSize ?? '100'), 10)
  mkdirSync(LABELS_DIR, { recursive: true })

  if (!existsSync(QUERIES_PATH)) {
    console.error('[retrieve-candidates] No queries.json found. Run generate-queries first.')
    process.exitCode = 1
    return
  }

  const queries: Query[] = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'))
  console.log(`[retrieve-candidates] ${queries.length} queries, pageSize=${pageSize}`)

  // Deep negative ranks
  const deepRanks = sampleDeep(1736)
  const deepRankSet = new Set(deepRanks)

  const candidates: Candidate[] = []

  for (const q of queries) {
    try {
      const result = await searchProductsBySituation({
        query: q.query,
        locale: 'zh-TW',
        mode: 'hybrid',
        pageSize,
        category: q.category ?? null,
        enableIntentParse: false,
      })

      for (let rank = 0; rank < result.products.length; rank++) {
        const rrfRank = rank + 1
        // Keep ranks 1-20 plus deep negatives
        if (rrfRank <= 20 || deepRankSet.has(rrfRank)) {
          const p = result.products[rank]!
          candidates.push({
            queryId: q.id,
            brandSlug: p.brandSlug,
            productKey: p.key,
            productId: p.id,
            rrfRank,
            searchSource: result.searchSource,
          })
        }
      }

      console.log(`  ${q.id}: ${result.products.length} results`)
    } catch (err) {
      console.warn(`  ${q.id}: FAILED -`, err instanceof Error ? err.message : err)
    }
  }

  writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2))
  console.log(`[retrieve-candidates] Wrote ${candidates.length} candidates to ${CANDIDATES_PATH}`)
}

// ---------------------------------------------------------------------------
// cmdJudge
// ---------------------------------------------------------------------------

export async function cmdJudge(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log(
      'Usage: pnpm search:eval judge [--model gpt-4o-mini] [--samples 3] [--temperature 0.7] [--force]',
    )
    console.log(
      '  Runs LLM judge (multi-sample) on (query, product) pairs, outputs 0-3 grade',
    )
    return
  }

  const samples = parseInt(String(values.samples ?? '3'), 10)
  const temperature = parseFloat(String(values.temperature ?? '0.7'))
  const force = Boolean(values.force)

  mkdirSync(LABELS_DIR, { recursive: true })

  if (!existsSync(CANDIDATES_PATH)) {
    console.error('[judge] No candidates.json found. Run retrieve-candidates first.')
    process.exitCode = 1
    return
  }

  const candidates: Candidate[] = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8'))
  const queries: Query[] = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'))
  const queryMap = new Map(queries.map(q => [q.id, q]))

  // Load existing judged pairs for resume
  let existing: JudgedPair[] = []
  if (existsSync(JUDGED_PAIRS_PATH) && !force) {
    existing = JSON.parse(readFileSync(JUDGED_PAIRS_PATH, 'utf8'))
    console.log(`[judge] Resuming from ${existing.length} existing judged pairs`)
  }

  const completedKeys = new Set(
    existing.map(p => `${p.queryId}|${p.brandSlug}|${p.productKey}`),
  )

  // Group candidates by queryId
  const byQuery = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const arr = byQuery.get(c.queryId) ?? []
    arr.push(c)
    byQuery.set(c.queryId, arr)
  }

  // Load all product IDs for batch lookup
  const allProductIds = [...new Set(candidates.map(c => c.productId))]
  console.log(`[judge] Loading ${allProductIds.length} products...`)

  // Batch load products
  const productMap = new Map<string, {
    nameZh: string
    nameEn: string | null
    category: string
    subcategory: string
    materials: string[]
    descriptionZh: string
    officialUrl: string
  }>()

  for (let i = 0; i < allProductIds.length; i += 100) {
    const batch = allProductIds.slice(i, i + 100)
    const { products } = await getPublishedCuratedProducts({ ids: batch })
    for (const p of products) {
      productMap.set(p.id, {
        nameZh: p.nameZh,
        nameEn: p.nameEn,
        category: p.category,
        subcategory: p.subcategory,
        materials: p.material,
        descriptionZh: p.productDescriptionZh,
        officialUrl: p.officialUrl ?? '',
      })
    }
  }

  // Fetch prompt once
  const promptMeta = await fetchLangfusePromptWithMeta('search-relevance-judge')

  const judgedPairs = [...existing]

  for (const [queryId, queryCandidates] of byQuery) {
    const q = queryMap.get(queryId)
    if (!q) continue

    const pending = queryCandidates.filter(
      c => !completedKeys.has(`${c.queryId}|${c.brandSlug}|${c.productKey}`),
    )
    if (pending.length === 0) continue

    console.log(`[judge] ${queryId}: judging ${pending.length} candidates...`)

    for (const c of pending) {
      const product = productMap.get(c.productId)
      if (!product) {
        console.warn(`  ${c.productId}: product not found, skipping`)
        continue
      }

      const result = await judgeRelevance(
        {
          query: q.query,
          product: {
            name_zh: product.nameZh,
            name_en: product.nameEn,
            category_zh: product.category,
            subcategory_zh: product.subcategory,
            materials_zh: product.materials.join(', '),
            description_zh: product.descriptionZh,
          },
        },
        {
          fetchPrompt: async () => promptMeta,
          samples,
          temperature,
        },
      )

      judgedPairs.push({
        queryId: c.queryId,
        query: q.query,
        brandSlug: c.brandSlug,
        productKey: c.productKey,
        nameZh: product.nameZh,
        descriptionZh: product.descriptionZh,
        officialUrl: product.officialUrl,
        categoryZh: product.category,
        votes: result.votes,
        grade: result.grade ?? 0,
        split: result.split,
      })
    }

    // Write after each query for resume safety
    writeFileSync(JUDGED_PAIRS_PATH, JSON.stringify(judgedPairs, null, 2))
  }

  console.log(`[judge] Total judged pairs: ${judgedPairs.length}`)

  // Emit hand-label sheet
  const existingSheet = existsSync(HAND_LABEL_SHEET_PATH)
    ? fromCsv(readFileSync(HAND_LABEL_SHEET_PATH, 'utf8'))
    : undefined

  const sheet = stratifiedSheet(judgedPairs, 150, existingSheet)
  writeFileSync(HAND_LABEL_SHEET_PATH, toCsv(sheet))
  console.log(`[judge] Wrote ${sheet.length} rows to ${HAND_LABEL_SHEET_PATH}`)
}
