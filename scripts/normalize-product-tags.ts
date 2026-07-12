/**
 * Backfill script: normalize product tags for all approved brands.
 *
 * Pass 1 — deterministic: planTagBackfill resolves vocab matches to canonical zh/en.
 * Pass 2 — LLM: unmatched tags batched per L1 category to DeepSeek for slug mapping.
 * Pass 3 — novels: LLM-null tags run through normalizeProductTags heuristics.
 *
 * Usage:
 *   pnpm exec ts-node -P tsconfig.json scripts/normalize-product-tags.ts [--dry-run] [--batch-size=50]
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createDeepSeekClient, parseDeepSeekJson } from '@/lib/services/deepseek-client'
import { planTagBackfill, normalizeProductTags } from '@/lib/services/product-tags'
import { updateBrand } from '@/lib/services/brands'
import { PRODUCT_SUBCATEGORIES, type ProductSubcategory } from '@/lib/taxonomy/ontology'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TAGS = 5
const DISTINCT_AFTER_THRESHOLD = 350

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CliOptions = {
  dryRun: boolean
  batchSize: number
}

type BrandRow = {
  id: string
  slug: string
  product_type: string | null
  product_tags: string[] | null
  product_tags_en: string[] | null
}

type TagSource = 'matched' | 'llm' | 'novel' | 'dropped'

type PairWithSource = {
  zh: string
  en: string
  originalTag: string
  source: Exclude<TagSource, 'dropped'>
}

type BrandResult = {
  brand: BrandRow
  beforeZh: string[]
  afterZh: string[]
  afterEn: string[]
  perTagSource: Map<string, TagSource>
}

// ---------------------------------------------------------------------------
// Module-level lookups (computed once)
// ---------------------------------------------------------------------------

const slugToSub = new Map<string, ProductSubcategory>()
for (const sub of PRODUCT_SUBCATEGORIES) {
  slugToSub.set(sub.slug, sub)
}

const categorySubcategories = new Map<string, ProductSubcategory[]>()
for (const sub of PRODUCT_SUBCATEGORIES) {
  const list = categorySubcategories.get(sub.category) ?? []
  list.push(sub)
  categorySubcategories.set(sub.category, list)
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes('--dry-run')
  const batchSizeArg = argv.find((arg) => arg.startsWith('--batch-size='))
  const batchSize = batchSizeArg
    ? Number(batchSizeArg.slice('--batch-size='.length))
    : 50

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer')
  }

  return { dryRun, batchSize }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createSupabaseClient(url, serviceRoleKey)
}

// ---------------------------------------------------------------------------
// LLM mapping
// ---------------------------------------------------------------------------

async function mapTagsWithLlm(
  client: ReturnType<typeof createDeepSeekClient>,
  category: string,
  tags: string[],
): Promise<Map<string, string | null>> {
  if (tags.length === 0) return new Map()

  const subs = categorySubcategories.get(category) ?? []
  const slugList = subs.map((s) => `${s.slug} (${s.nameZh})`).join('\n')

  const system =
    'You are a product taxonomy assistant for a Made in Taiwan brand directory. ' +
    'Map Chinese product tags to predefined subcategory slugs. Return only valid JSON.'

  const user =
    `Map each Chinese product tag to the most fitting subcategory slug from the list below, ` +
    `or null if none fits well.\n\n` +
    `Available slugs for category "${category}":\n${slugList}\n\n` +
    `Tags to map (return a JSON object mapping each tag string to a slug string or null):\n` +
    tags.join('\n')

  const result = await client.chat({ system, user, json: true, timeoutMs: 30_000 })

  if (!result.content) {
    console.warn(`[llm] call failed for category "${category}" — treating all as unmatched`)
    return new Map(tags.map((t) => [t, null]))
  }

  const mapping = parseDeepSeekJson<Record<string, string | null>>(result.content)
  if (!mapping) {
    console.warn(`[llm] invalid JSON for category "${category}" — treating all as unmatched`)
    return new Map(tags.map((t) => [t, null]))
  }

  const out = new Map<string, string | null>()
  for (const tag of tags) {
    const slug = mapping[tag]
    if (typeof slug === 'string' && slugToSub.has(slug)) {
      out.set(tag, slug)
    } else {
      out.set(tag, null)
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Per-brand result composition
// ---------------------------------------------------------------------------

function composeResult(
  brand: BrandRow,
  plan: ReturnType<typeof planTagBackfill>,
  llmMapping: Map<string, string | null>,
): BrandResult {
  const beforeZh = brand.product_tags ?? []
  const beforeEn = brand.product_tags_en ?? []

  const zhToEn = new Map<string, string>()
  for (let i = 0; i < beforeZh.length; i++) {
    const zh = beforeZh[i]
    if (zh) zhToEn.set(zh, beforeEn[i] ?? zh)
  }

  const pairs: PairWithSource[] = []
  const seenSlugs = new Set<string>()
  const droppedTags = new Set<string>()

  // Pass 1 — deterministic vocab matches
  for (const m of plan.matched) {
    if (seenSlugs.has(m.slug)) {
      droppedTags.add(m.original)
      continue
    }
    seenSlugs.add(m.slug)
    pairs.push({ zh: m.canonicalZh, en: m.canonicalEn, originalTag: m.original, source: 'matched' })
  }

  // Pass 2 — LLM-mapped + novel heuristics
  for (const unmatchedTag of plan.unmatched) {
    const slug = llmMapping.get(unmatchedTag)
    if (typeof slug === 'string') {
      const sub = slugToSub.get(slug)
      if (sub && !seenSlugs.has(sub.slug)) {
        seenSlugs.add(sub.slug)
        pairs.push({ zh: sub.nameZh, en: sub.nameEn, originalTag: unmatchedTag, source: 'llm' })
      } else {
        droppedTags.add(unmatchedTag)
      }
    } else {
      // LLM returned null — apply normalizeProductTags novel heuristics
      const novel = normalizeProductTags([unmatchedTag], [zhToEn.get(unmatchedTag) ?? ''])
      if (novel.tags.length > 0) {
        pairs.push({
          zh: novel.tags[0]!,
          en: novel.tagsEn[0] ?? unmatchedTag,
          originalTag: unmatchedTag,
          source: 'novel',
        })
      } else {
        droppedTags.add(unmatchedTag)
      }
    }
  }

  // Cap at MAX_TAGS
  const capped = pairs.slice(0, MAX_TAGS)
  const cappedOriginals = new Set(capped.map((p) => p.originalTag))

  const perTagSource = new Map<string, TagSource>()
  for (const p of capped) perTagSource.set(p.originalTag, p.source)
  for (const t of droppedTags) perTagSource.set(t, 'dropped')
  for (const p of pairs.slice(MAX_TAGS)) {
    if (!cappedOriginals.has(p.originalTag)) perTagSource.set(p.originalTag, 'dropped')
  }

  return {
    brand,
    beforeZh,
    afterZh: capped.map((p) => p.zh),
    afterEn: capped.map((p) => p.en),
    perTagSource,
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildCsvRow(result: BrandResult): string {
  const beforeZh = result.beforeZh.join('|')
  const afterZh = result.afterZh.join('|')
  const perTagSource = Array.from(result.perTagSource.entries())
    .map(([t, s]) => `${t}:${s}`)
    .join('|')

  return [result.brand.slug, beforeZh, afterZh, perTagSource].map(csvField).join(',')
}

async function writeCsv(results: BrandResult[]): Promise<void> {
  const dir = path.resolve('scripts/eval/results')
  await mkdir(dir, { recursive: true })

  const outPath = path.join(dir, 'normalize-product-tags-dryrun.csv')
  const header = 'brand_slug,before_zh,after_zh,per_tag_source'
  const rows = results.map(buildCsvRow)
  await writeFile(outPath, [header, ...rows].join('\n') + '\n', 'utf8')
  console.log(`CSV written to ${outPath}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()
  const deepseek = createDeepSeekClient()

  // Step 1 — paginated load of approved brands with non-empty product_tags
  const brands: BrandRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select('id, slug, product_type, product_tags, product_tags_en')
      .eq('status', 'approved')
      .not('product_tags', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + options.batchSize - 1)

    if (error) throw error

    const batch = (data ?? []) as BrandRow[]
    // Keep only brands with at least one tag
    brands.push(...batch.filter((b) => (b.product_tags ?? []).length > 0))

    if (batch.length < options.batchSize) break
    offset += options.batchSize
  }

  console.log(`Loaded ${brands.length} brand(s) with product_tags`)

  // Step 2 — deterministic pass per brand
  const brandPlans = brands.map((brand) => ({
    brand,
    plan: planTagBackfill(brand.product_tags ?? []),
  }))

  // Step 3 — collect unique unmatched tags per L1 category
  const categoryUnmatched = new Map<string, Set<string>>()
  for (const { brand, plan } of brandPlans) {
    if (plan.unmatched.length === 0) continue
    const category = brand.product_type ?? 'unknown'
    if (!categoryUnmatched.has(category)) {
      categoryUnmatched.set(category, new Set())
    }
    for (const tag of plan.unmatched) {
      categoryUnmatched.get(category)!.add(tag)
    }
  }

  // Step 4 — batch LLM calls per category
  const globalLlmMapping = new Map<string, Map<string, string | null>>()
  for (const [category, tags] of categoryUnmatched) {
    if (tags.size === 0) continue
    console.log(`[llm] mapping ${tags.size} tag(s) for category "${category}"`)
    const mapping = await mapTagsWithLlm(deepseek, category, Array.from(tags))
    globalLlmMapping.set(category, mapping)
  }

  // Step 5 — compose final per-brand tags
  const results: BrandResult[] = brandPlans.map(({ brand, plan }) => {
    const category = brand.product_type ?? 'unknown'
    const llmMapping = globalLlmMapping.get(category) ?? new Map<string, string | null>()
    return composeResult(brand, plan, llmMapping)
  })

  // Summary stats (used by both dry-run and execute)
  const changed = results.filter(
    (r) => JSON.stringify(r.beforeZh) !== JSON.stringify(r.afterZh),
  ).length
  const distinctBefore = new Set(results.flatMap((r) => r.beforeZh)).size
  const distinctAfter = new Set(results.flatMap((r) => r.afterZh)).size
  const totalOriginalTags = results.flatMap((r) => r.beforeZh).length
  const mappedCount = results
    .flatMap((r) => Array.from(r.perTagSource.values()))
    .filter((s) => s !== 'dropped').length
  const pctMapped =
    totalOriginalTags > 0
      ? ((mappedCount / totalOriginalTags) * 100).toFixed(1)
      : '0'

  if (options.dryRun) {
    // Step 6 — dry-run: write CSV + summary
    await writeCsv(results)

    console.log('\n--- Dry Run Summary ---')
    console.log(`Brands scanned:    ${results.length}`)
    console.log(`Brands changed:    ${changed}`)
    console.log(`Distinct before:   ${distinctBefore}`)
    console.log(`Distinct after:    ${distinctAfter}`)
    console.log(`% mapped:          ${pctMapped}%`)
    console.log(`Skips:             0 (dry run — no writes)`)
  } else {
    // Sanity thresholds before any writes
    if (distinctAfter > DISTINCT_AFTER_THRESHOLD) {
      console.error(
        `ABORT: distinct-after tag count (${distinctAfter}) exceeds threshold (${DISTINCT_AFTER_THRESHOLD})`,
      )
      process.exit(1)
    }

    for (const result of results) {
      if (result.beforeZh.length > 0 && result.afterZh.length === 0) {
        console.error(
          `ABORT: brand "${result.brand.slug}" would go from ${result.beforeZh.length} tag(s) to 0`,
        )
        process.exit(1)
      }
    }

    // Step 7 — execute: write via updateBrand
    let skipCount = 0
    let writeCount = 0

    for (const result of results) {
      if (JSON.stringify(result.beforeZh) === JSON.stringify(result.afterZh)) continue

      const writeResult = await updateBrand(
        result.brand.id,
        { productTags: result.afterZh, productTagsEn: result.afterEn },
        { source: 'enriched' },
      )

      if (writeResult.skipped.length > 0) {
        skipCount += writeResult.skipped.length
        const skipDetail = writeResult.skipped
          .map((s) => `${s.field}:${s.reason}`)
          .join(', ')
        console.log(`SKIP ${result.brand.slug}: ${skipDetail}`)
      } else {
        writeCount++
      }
    }

    console.log('\n--- Execute Summary ---')
    console.log(`Brands scanned:    ${results.length}`)
    console.log(`Brands written:    ${writeCount}`)
    console.log(`Brands changed:    ${changed}`)
    console.log(`Distinct before:   ${distinctBefore}`)
    console.log(`Distinct after:    ${distinctAfter}`)
    console.log(`% mapped:          ${pctMapped}%`)
    console.log(`Field skips:       ${skipCount}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
