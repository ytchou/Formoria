/**
 * One-shot script: queries production for approved brands in the 6 visible L1
 * categories and generates per-category cohort JSON files, plus a safety cohort
 * (1 brand per category, ~5 total) and a dryrun cohort (~20 brands proportional
 * to category sizes).
 *
 * Usage:
 *   npx tsx --env-file=.env.staging scripts/curation-rerun/generate-visible-cohort.ts
 */

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VISIBLE_CATEGORIES = ['fashion', 'bags-accessories', 'jewelry', 'beauty', 'home', 'stationery'] as const
const EXCLUDED_SLUGS = ['li-jaou', 'sammm-studio', 'boingboing']
const COHORT_DIR = 'scripts/curation-cohorts'
const PAGE_SIZE = 1000

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key)

// ---------------------------------------------------------------------------
// Query (paginated — PostgREST max-rows is 1000)
// ---------------------------------------------------------------------------

type BrandRow = { slug: string; name: string; category: string }

async function fetchApprovedBrands(): Promise<BrandRow[]> {
  const all: BrandRow[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select('slug, name, category')
      .eq('status', 'approved')
      .in('category', [...VISIBLE_CATEGORIES])
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Query failed: ${error.message}`)
    if (!data) break

    all.push(...(data as BrandRow[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return all
}

// ---------------------------------------------------------------------------
// Cohort JSON builder
// ---------------------------------------------------------------------------

function buildCohort(
  name: string,
  title: string,
  subtitle: string,
  brands: BrandRow[],
): Record<string, unknown> {
  const sorted = [...brands].sort((a, b) => a.slug.localeCompare(b.slug))
  const labels: Record<string, string> = {}
  for (const b of sorted) labels[b.slug] = b.name
  return { name, title, subtitle, labels }
}

async function writeCohort(filename: string, data: Record<string, unknown>): Promise<void> {
  const path = `${COHORT_DIR}/${filename}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const raw = await fetchApprovedBrands()

  // Filter exclusions
  const brands = raw.filter((b) => !EXCLUDED_SLUGS.includes(b.slug))
  const excludedCount = raw.length - brands.length

  // Group by category
  const byCategory = new Map<string, BrandRow[]>()
  for (const b of brands) {
    const list = byCategory.get(b.category) ?? []
    list.push(b)
    byCategory.set(b.category, list)
  }

  // Sort categories by ascending brand count
  const sortedCategories = [...byCategory.entries()].sort((a, b) => a[1].length - b[1].length)

  // --- Per-category cohorts ---
  for (const [category, catBrands] of sortedCategories) {
    const cohort = buildCohort(
      `dev-1616-${category}`,
      `DEV-1616 — ${category} curated product population`,
      `All approved brands in ${category}`,
      catBrands,
    )
    await writeCohort(`dev-1616-${category}.json`, cohort)
  }

  // --- Safety cohort: 1 brand from each category (smallest first), up to 5 ---
  const safetyBrands: BrandRow[] = []
  for (const [, catBrands] of sortedCategories) {
    if (safetyBrands.length >= 5) break
    const sorted = [...catBrands].sort((a, b) => a.slug.localeCompare(b.slug))
    safetyBrands.push(sorted[0])
  }
  const safetyCohort = buildCohort(
    'dev-1616-safety',
    'DEV-1616 — safety cohort (1 per category)',
    `${safetyBrands.length} brands, 1 from each smallest category`,
    safetyBrands,
  )
  await writeCohort('dev-1616-safety.json', safetyCohort)

  // --- Dryrun cohort: ~20 brands proportional to category size ---
  const totalCount = brands.length
  const TARGET = 20
  const dryrunBrands: BrandRow[] = []

  // Compute per-category allocation
  const allocations: { category: string; count: number; brands: BrandRow[] }[] = []
  let allocatedTotal = 0
  for (const [category, catBrands] of sortedCategories) {
    const count = Math.max(1, Math.round((catBrands.length / totalCount) * TARGET))
    allocations.push({ category, count, brands: catBrands })
    allocatedTotal += count
  }

  // Cap if total exceeds TARGET — trim from largest categories
  while (allocatedTotal > TARGET) {
    // Find the allocation with the largest count
    const largest = allocations.reduce((max, a) => (a.count > max.count ? a : max), allocations[0])
    if (largest.count <= 1) break
    largest.count--
    allocatedTotal--
  }

  for (const { brands: catBrands, count } of allocations) {
    const sorted = [...catBrands].sort((a, b) => a.slug.localeCompare(b.slug))
    if (count >= sorted.length) {
      dryrunBrands.push(...sorted)
    } else {
      // Pick evenly spaced brands
      for (let i = 0; i < count; i++) {
        const idx = Math.round((i * (sorted.length - 1)) / (count - 1 || 1))
        dryrunBrands.push(sorted[idx])
      }
    }
  }

  const dryrunCohort = buildCohort(
    'dev-1616-dryrun',
    'DEV-1616 — dryrun cohort (~20 brands)',
    `${dryrunBrands.length} brands sampled proportionally from ${sortedCategories.length} categories`,
    dryrunBrands,
  )
  await writeCohort('dev-1616-dryrun.json', dryrunCohort)

  // --- Summary ---
  console.log('\n=== DEV-1616 visible-cohort generation ===\n')
  for (const [category, catBrands] of sortedCategories) {
    console.log(`  ${category}: ${catBrands.length} brands`)
  }
  console.log(`\n  Total: ${brands.length} brands`)
  console.log(`  Excluded: ${excludedCount} (${EXCLUDED_SLUGS.join(', ')})`)
  console.log(`  Safety cohort: ${safetyBrands.length} brands`)
  console.log(`  Dryrun cohort: ${dryrunBrands.length} brands`)
  console.log(`\n  Written to: ${COHORT_DIR}/dev-1616-*.json\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
