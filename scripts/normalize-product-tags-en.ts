/**
 * DEV-1266 backfill: re-derive `product_tags_en` for every brand.
 *
 * `product_tags_en` is a pure function of `product_tags`: an ontology hit takes
 * the canonical `nameEn` ('後背包' -> 'Backpacks'), a novel tag keeps whatever
 * English is already stored, Title Cased ('sling bag' -> 'Sling Bag'), and a
 * novel tag with no stored English falls back to the raw Chinese. All of that
 * lives in `deriveProductTagsEn`, so this script is deterministic — no LLM, no
 * DeepSeek, no network beyond Supabase.
 *
 * `toBrandRow` in `src/lib/services/field-map.ts` now runs the same normalizer
 * on every brand write, so nothing can reintroduce the drift this repairs.
 * After the first run this script should stay a no-op; a non-zero "brands
 * changed" on a later run means a write path bypassed `toBrandRow`.
 *
 * Usage:
 *   pnpm normalize-tags-en [--dry-run] [--batch-size=50]
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { deriveProductTagsEn } from '@/lib/services/product-tags'
import { updateBrand } from '@/lib/services/brands'
import { requestPublicBrandRevalidation } from '@/lib/cache/revalidate-client'

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
  product_tags: string[] | null
  product_tags_en: string[] | null
}

type BrandResult = {
  brand: BrandRow
  tags: string[]
  beforeEn: string[]
  afterEn: string[]
  changed: boolean
  misaligned: boolean
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()

  // Every status, not just `approved`: hidden brands are published the moment a
  // moderator flips the flag, so their EN tags have to be correct too.
  const brands: BrandRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select('id, slug, product_tags, product_tags_en')
      .order('id', { ascending: true })
      .range(offset, offset + options.batchSize - 1)

    if (error) throw error

    const batch = (data ?? []) as BrandRow[]
    brands.push(...batch)

    if (batch.length < options.batchSize) break
    offset += options.batchSize
  }

  console.log(`Loaded ${brands.length} brand(s)`)

  const results: BrandResult[] = brands.map((brand) => {
    const tags = brand.product_tags ?? []
    const beforeEn = brand.product_tags_en ?? []
    const afterEn = deriveProductTagsEn(tags, beforeEn)
    return {
      brand,
      tags,
      beforeEn,
      afterEn,
      changed: JSON.stringify(beforeEn) !== JSON.stringify(afterEn),
      // More EN entries than zh entries means the two arrays were never
      // index-aligned, so `product_tags_en[i]` does not describe
      // `product_tags[i]`. Deriving would either truncate real chips or carry
      // the wrong pairing forward — both are guesses this script must not make.
      misaligned: beforeEn.length > tags.length,
    }
  })

  const misalignedResults = results.filter((r) => r.misaligned)
  const changedResults = results.filter((r) => r.changed && !r.misaligned)
  const distinctBefore = new Set(results.flatMap((r) => r.beforeEn)).size
  // Misaligned brands keep their stored EN, so count that — not the derived
  // array — towards the post-run vocabulary.
  const distinctAfter = new Set(
    results.flatMap((r) => (r.misaligned ? r.beforeEn : r.afterEn)),
  ).size

  for (const result of changedResults) {
    console.log(
      `${result.brand.slug}: ${JSON.stringify(result.beforeEn)} -> ${JSON.stringify(result.afterEn)}`,
    )
  }

  for (const result of misalignedResults) {
    console.warn(
      `MISALIGNED (skipped, needs a human): ${result.brand.slug} — zh(${result.tags.length})=${JSON.stringify(result.tags)} en(${result.beforeEn.length})=${JSON.stringify(result.beforeEn)}`,
    )
  }

  if (options.dryRun) {
    console.log('\n--- Dry Run Summary ---')
    console.log(`Brands scanned:     ${results.length}`)
    console.log(`Brands changed:     ${changedResults.length}`)
    console.log(`Distinct EN before: ${distinctBefore}`)
    console.log(`Distinct EN after:  ${distinctAfter}`)
    console.log(`Skips:              0 (dry run — no writes)`)
    console.log(`Misaligned skipped: ${misalignedResults.length}`)
    return
  }

  // Sanity threshold before any writes: a brand that still has zh tags must
  // never end up with zero EN tags — `deriveProductTagsEn` is index-aligned, so
  // that can only mean the zh array was misread. A brand with zero zh tags
  // legitimately normalizes to zero EN tags (rnl-threads is exactly that: one
  // orphaned EN tag, no zh), so it is excluded from the guard.
  for (const result of changedResults) {
    if (
      result.tags.length > 0 &&
      result.beforeEn.length > 0 &&
      result.afterEn.length === 0
    ) {
      console.error(
        `ABORT: brand "${result.brand.slug}" would go from ${result.beforeEn.length} EN tag(s) to 0 while keeping ${result.tags.length} zh tag(s)`,
      )
      process.exit(1)
    }
  }

  let skipCount = 0
  let writeCount = 0
  const writtenSlugs: string[] = []

  for (const result of changedResults) {
    // `productTags` has to go along: `toBrandRow` now derives the EN array from
    // it, so a patch carrying only `productTagsEn` would derive against an empty
    // zh array and wipe the column.
    const writeResult = await updateBrand(
      result.brand.id,
      { productTags: result.tags, productTagsEn: result.afterEn },
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
      writtenSlugs.push(result.brand.slug)
    }
  }

  // These writes happen outside a Next request, so nothing invalidates the ISR
  // entries on its own — without this the corrected chips stay stale on the
  // public pages until the next scheduled revalidation.
  if (writtenSlugs.length > 0) {
    const revalidation = await requestPublicBrandRevalidation(writtenSlugs)
    if (revalidation.ok) {
      console.log(`Revalidated ${writtenSlugs.length} brand page(s)`)
    } else {
      console.warn(
        `Revalidation skipped: ${revalidation.reason ?? 'unknown'} — the public pages stay stale until the next revalidation`,
      )
    }
  }

  console.log('\n--- Execute Summary ---')
  console.log(`Brands scanned:     ${results.length}`)
  console.log(`Brands changed:     ${changedResults.length}`)
  console.log(`Brands written:     ${writeCount}`)
  console.log(`Distinct EN before: ${distinctBefore}`)
  console.log(`Distinct EN after:  ${distinctAfter}`)
  console.log(`Field skips:        ${skipCount}`)
  console.log(`Misaligned skipped: ${misalignedResults.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
