import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'

import { createAuditedOpenAIClient } from '@/lib/services/llm-audit'
import { getPublishedCuratedProducts } from '@/lib/services/curated-products-catalog'
import { getBrands } from '@/lib/services/brands'
import { L1_CATEGORIES, L2_SUBCATEGORIES, MATERIALS } from '@/lib/taxonomy/ontology'
import { LABELS_DIR, QUERIES_PATH } from './label-shared'

// ---------------------------------------------------------------------------
// V1 queries (hardcoded from the deleted retrieval-golden.json)
// ---------------------------------------------------------------------------

const V1_QUERIES: Array<{ id: string; query: string }> = [
  { id: 'tea-gift-for-friend', query: '送給喜歡泡茶的朋友' },
  { id: 'birthday-gift-for-her', query: '女生生日禮物推薦' },
  { id: 'minimalist-home-decor', query: '極簡風格居家佈置' },
  { id: 'taiwanese-snack-souvenirs', query: '台灣伴手禮推薦' },
  { id: 'eco-friendly-daily-essentials', query: '環保日常用品' },
  { id: 'handmade-leather-accessories', query: '手工皮件配飾' },
  { id: 'wedding-gift-ideas', query: '結婚禮物推薦' },
  { id: 'baby-shower-gift', query: '新生兒禮物' },
  { id: 'outdoor-camping-gear', query: '露營好物推薦' },
  { id: 'home-fragrance', query: '居家香氛推薦' },
  { id: 'pet-friendly-products', query: '寵物友善商品' },
  { id: 'office-desk-accessories', query: '辦公桌療癒小物' },
  { id: 'ceramic-tableware', query: '陶瓷餐具推薦' },
  { id: 'summer-sun-protection', query: '夏天防曬好物' },
  { id: 'natural-skincare', query: '天然保養品推薦' },
  { id: 'travel-essentials', query: '旅行必備小物' },
  { id: 'gift-for-tea-lovers', query: '茶具禮盒推薦' },
  { id: 'woodfired-ceramics', query: '柴燒陶器推薦' },
  { id: 'indigo-dye-bag', query: '藍染布包' },
  { id: 'office-desk-organizer', query: '辦公桌上的收納小物' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

type QueryKind = 'brand' | 'keyword' | 'english'
type CatalogQueryProduct = { brandSlug: string; subcategory: string; nameEn: string | null }
type CatalogQueryBrand = { slug: string; name: string; romanizedName?: string | null }

export function catalogQueries(
  kind: QueryKind,
  products: CatalogQueryProduct[],
  brands: CatalogQueryBrand[],
  count: number,
): Array<{ id: string; query: string; queryType: 'brand_name' | 'keyword' | 'english'; source: string }> {
  const publishedBrandSlugs = new Set(products.map(p => p.brandSlug))
  const values = kind === 'brand'
    ? brands.filter(b => publishedBrandSlugs.has(b.slug)).flatMap(b => [b.name, b.romanizedName])
    : kind === 'keyword'
      ? products.map(p => L2_SUBCATEGORIES.find(s => s.slug === p.subcategory)?.nameZh)
      : products.map(p => p.nameEn)
  const queryType = kind === 'brand' ? 'brand_name' : kind
  return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0))]
    .sort()
    .slice(0, count)
    .map(query => ({ id: `${kind}-${slugify(query)}`, query, queryType, source: `catalog-${kind}` }))
}

async function publishedCatalogProducts() {
  const pageSize = 200
  const first = await getPublishedCuratedProducts({ pageSize, page: 1 })
  const remainingPages = Array.from(
    { length: Math.ceil(first.totalCount / pageSize) - 1 },
    (_, index) => index + 2,
  )
  const rest = await Promise.all(remainingPages.map(page => getPublishedCuratedProducts({ pageSize, page })))
  return [...first.products, ...rest.flatMap(result => result.products)]
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function cmdGenerateQueries(
  values: Record<string, unknown>,
): Promise<void> {
  if (values.help) {
    console.log('Usage: pnpm search:eval generate-queries [--kind brand|keyword|english] [--count 20]')
    console.log('  Generates zh-TW situation query candidates from taxonomy + product descriptions')
    return
  }

  const kind = values.kind ? String(values.kind) : null
  if (kind && !['brand', 'keyword', 'english'].includes(kind)) {
    throw new Error(`Unknown query kind: ${kind}`)
  }
  if (kind) {
    const products = await publishedCatalogProducts()
    const { brands, totalCount } = kind === 'brand'
      ? await getBrands({ status: 'approved', limit: 1000 })
      : { brands: [], totalCount: 0 }
    if (brands.length !== totalCount) throw new Error('Approved brand read was truncated')
    const generated = catalogQueries(
      kind as QueryKind,
      products,
      brands,
      parseInt(String(values.count ?? (kind === 'english' ? '10' : '20')), 10),
    )
    mkdirSync(LABELS_DIR, { recursive: true })
    const existing = existsSync(QUERIES_PATH)
      ? JSON.parse(readFileSync(QUERIES_PATH, 'utf8')) as typeof generated
      : []
    const byId = new Map(existing.map(query => [query.id, query]))
    for (const query of generated) byId.set(query.id, query)
    writeFileSync(QUERIES_PATH, JSON.stringify([...byId.values()], null, 2))
    console.log(`[generate-queries] Added ${generated.length} ${kind} queries to ${QUERIES_PATH}`)
    return
  }

  const targetCount = parseInt(String(values.count ?? '220'), 10)
  mkdirSync(LABELS_DIR, { recursive: true })

  // Load existing queries if any (for idempotent re-runs)
  let existing: Array<{ id: string; query: string; category?: string; source: string }> = []
  if (existsSync(QUERIES_PATH)) {
    existing = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'))
    console.log(`[generate-queries] Loaded ${existing.length} existing queries`)
  }

  // Start with v1 queries
  const v1Ids = new Set(V1_QUERIES.map(q => q.id))
  const queries: Array<{ id: string; query: string; category?: string; source: string }> = [
    ...V1_QUERIES.map(q => ({ ...q, source: 'v1-golden' })),
  ]

  // Remove v1 duplicates from existing
  for (const eq of existing) {
    if (!v1Ids.has(eq.id) && !queries.some(q => q.id === eq.id)) {
      queries.push(eq)
    }
  }

  const needed = targetCount - queries.length
  if (needed <= 0) {
    console.log(`[generate-queries] Already have ${queries.length} queries, target is ${targetCount}`)
    writeFileSync(QUERIES_PATH, JSON.stringify(queries, null, 2))
    return
  }

  console.log(`[generate-queries] Need ${needed} more queries (have ${queries.length}, target ${targetCount})`)

  // Sample product descriptions from catalog
  const { products } = await getPublishedCuratedProducts({ pageSize: 200 })
  const sampleDescriptions = products
    .filter(p => p.productDescriptionZh)
    .slice(0, 60)
    .map(p => `${p.nameZh}: ${p.productDescriptionZh.slice(0, 100)}`)
    .join('\n')

  // Build category/material context
  const categoryList = L1_CATEGORIES.map(c => `${c.slug}: ${c.nameZh}`).join('\n')
  const materialList = MATERIALS.map(m => `${m.slug}: ${m.nameZh}`).join('\n')

  // Generate queries in batches
  const batchSize = 20
  const client = createAuditedOpenAIClient({ phase: 'search_query_generate' })

  for (let i = 0; i < needed; i += batchSize) {
    const batchCount = Math.min(batchSize, needed - i)
    console.log(`[generate-queries] Generating batch of ${batchCount}...`)

    const result = await client.chat({
      system: [
        'You generate realistic zh-TW situation queries that a consumer might type when searching for Taiwanese products on Formoria.',
        '',
        'Categories:',
        categoryList,
        '',
        'Materials:',
        materialList,
        '',
        'Rules:',
        '- Each query describes a situation, need, or occasion (not a product name)',
        '- Use natural zh-TW language, 5–30 characters',
        '- Cover diverse categories, materials, occasions, and gift scenarios',
        '- Include some queries with specific materials or categories',
        '- Do not repeat queries already generated',
      ].join('\n'),
      user: [
        `Generate ${batchCount} unique zh-TW situation queries as JSON array.`,
        '',
        'Sample products for reference:',
        sampleDescriptions,
        '',
        'Already generated queries to avoid duplicating:',
        queries.slice(-40).map(q => q.query).join(', '),
        '',
        'Return JSON: [{ "id": "kebab-case-id", "query": "zh-TW query text", "category": "optional-L1-slug-or-null" }]',
      ].join('\n'),
      json: true,
      temperature: 0.9,
    })

    try {
      let parsed: unknown = JSON.parse(result.content ?? '[]')
      if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
        const vals = Object.values(parsed as Record<string, unknown>)
        for (const v of vals) {
          if (Array.isArray(v) && v.length > 0) { parsed = v; break }
        }
      }
      if (!Array.isArray(parsed)) {
        console.warn('[generate-queries] Unexpected response shape:', typeof parsed, JSON.stringify(result.content?.slice(0, 200)))
      }
      const generated = (Array.isArray(parsed) ? parsed : []) as Array<{
        id: string
        query: string
        category?: string | null
      }>
      let batchAdded = 0
      let batchDupes = 0
      for (const g of generated) {
        const usedIds = new Set(queries.map(q => q.id))
        let id = slugify(g.id || g.query)
        if (queries.some(q => q.query === g.query)) { batchDupes++; continue }
        let suffix = 2
        while (usedIds.has(id)) { id = `${slugify(g.id || g.query)}-${suffix++}` }
        queries.push({
          id,
          query: g.query,
          ...(g.category ? { category: g.category } : {}),
          source: 'generated',
        })
        batchAdded++
      }
      console.log(`[generate-queries] batch: ${generated.length} raw, ${batchAdded} added, ${batchDupes} text dupes`)
    } catch {
      console.warn('[generate-queries] Failed to parse batch, skipping')
    }
  }

  writeFileSync(QUERIES_PATH, JSON.stringify(queries, null, 2))
  console.log(`[generate-queries] Wrote ${queries.length} queries to ${QUERIES_PATH}`)
}
