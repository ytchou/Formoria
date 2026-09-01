/* eslint-disable @typescript-eslint/no-explicit-any -- operational script with untyped Supabase client */
/**
 * Applies reviewed enrichment decisions via direct PostgREST PATCH.
 * Reads enriched values from the latest approved/pending submission per brand,
 * writes only accepted fields to the brands table.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/apply-review-decisions.ts --decisions <path> --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/apply-review-decisions.ts --decisions <path> --confirm
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key)

const DRY_RUN = process.argv.includes('--dry-run')
const CONFIRM = process.argv.includes('--confirm')

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv.at(i + 1)
}

type Decision = { slug: string; accept: string[]; reject: string[] }

// camelCase enriched_data key → snake_case brands column
const FIELD_MAP: Record<string, string> = {
  blurb: 'blurb',
  blurb_en: 'blurb_en',
  description: 'description',
  description_en: 'description_en',
  subcategories: 'subcategories',
  subcategories_en: 'subcategories_en',
  hero_image_storage_path: 'hero_image_storage_path',
  social_instagram: 'social_instagram',
  social_facebook: 'social_facebook',
  social_threads: 'social_threads',
  purchase_pinkoi: 'purchase_pinkoi',
  purchase_shopee: 'purchase_shopee',
  purchase_website: 'purchase_website',
  purchase_myship: 'purchase_myship',
  founding_year: 'founding_year',
  category: 'category',
}

// enriched_data JSONB stores snake_case keys in the database
const ENRICHED_KEY_MAP: Record<string, string[]> = {
  blurb: ['blurb'],
  blurb_en: ['blurb_en', 'blurbEn'],
  description: ['description'],
  description_en: ['description_en', 'descriptionEn'],
  subcategories: ['subcategories'],
  subcategories_en: ['subcategories_en', 'subcategoriesEn'],
  hero_image_storage_path: ['hero_image_storage_path', 'heroImageStoragePath'],
  social_instagram: ['social_instagram', 'socialInstagram'],
  social_facebook: ['social_facebook', 'socialFacebook'],
  social_threads: ['social_threads', 'socialThreads'],
  purchase_pinkoi: ['purchase_pinkoi', 'purchasePinkoi'],
  purchase_shopee: ['purchase_shopee', 'purchaseShopee'],
  purchase_website: ['purchase_website', 'purchaseWebsite'],
  purchase_myship: ['purchase_myship', 'purchaseMyship'],
  founding_year: ['founding_year', 'foundingYear'],
  category: ['category'],
}

function parseDecisions(text: string): Decision[] {
  const decisions: Decision[] = []
  let current: Decision | null = null

  for (const line of text.split('\n')) {
    const headerMatch = line.match(/^## .+ \(([a-z0-9一-鿿-]+)\)/)
    if (headerMatch) {
      if (current) decisions.push(current)
      current = { slug: headerMatch[1], accept: [], reject: [] }
      continue
    }
    if (!current) continue
    const acceptMatch = line.match(/^\s*Accept:\s*(.+)/)
    if (acceptMatch) {
      current.accept = acceptMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    }
    const rejectMatch = line.match(/^\s*Reject:\s*(.+)/)
    if (rejectMatch) {
      current.reject = rejectMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  if (current) decisions.push(current)
  return decisions
}

async function main() {
  const decisionsPath = argValue('--decisions')
  if (!decisionsPath) throw new Error('--decisions <path> is required')
  if (!DRY_RUN && !CONFIRM) throw new Error('Pass --dry-run or --confirm')

  const { readFile } = await import('node:fs/promises')
  const text = await readFile(decisionsPath, 'utf-8')
  const decisions = parseDecisions(text)
  console.log(`[apply] ${decisions.length} brand decisions, dry-run=${DRY_RUN}\n`)

  const slugs = decisions.map(d => d.slug)
  const { data: brands } = await supabase
    .from('brands')
    .select('id, slug')
    .in('slug', slugs)
  const brandIdBySlug = new Map((brands ?? []).map((b: any) => [b.slug, b.id]))

  // Get latest submission per brand with enriched data.
  // Query per brand to avoid PostgREST max-rows truncation (51 brands ×
  // multiple submissions each can exceed 1000).
  const subByBrandId = new Map<string, any>()
  for (const [, brandId] of brandIdBySlug) {
    const { data: subs } = await supabase
      .from('brand_submissions')
      .select('id, brand_id, enriched_data')
      .eq('intent', 'refresh')
      .eq('brand_id', brandId)
      .not('enriched_data', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
    if (subs?.[0]?.enriched_data) {
      subByBrandId.set(brandId, subs[0])
    }
  }

  let applied = 0
  let skipped = 0
  const failures: string[] = []

  for (const decision of decisions) {
    const brandId = brandIdBySlug.get(decision.slug)
    if (!brandId) {
      failures.push(`${decision.slug}: brand not found`)
      continue
    }
    const sub = subByBrandId.get(brandId)
    if (!sub?.enriched_data) {
      failures.push(`${decision.slug}: no enriched submission`)
      continue
    }

    const enriched = sub.enriched_data
    const patch: Record<string, any> = {}

    for (const field of decision.accept) {
      const dbCol = FIELD_MAP[field]
      const enrichedKeys = ENRICHED_KEY_MAP[field]
      if (!dbCol || !enrichedKeys) {
        console.warn(`  ${decision.slug}: unknown field "${field}" — skipped`)
        continue
      }
      let value: any
      for (const key of enrichedKeys) {
        if (enriched[key] !== undefined) { value = enriched[key]; break }
      }
      if (value !== undefined) {
        // Guard: skip submissions/ hero paths — image promotion didn't run
        if (dbCol === 'hero_image_storage_path' && typeof value === 'string' && value.startsWith('submissions/')) {
          console.warn(`  ${decision.slug}: skipped hero_image_storage_path (submissions/ path)`)
          continue
        }
        patch[dbCol] = value
      }
    }

    if (Object.keys(patch).length === 0) {
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`  ${decision.slug.padEnd(30)} would patch: ${Object.keys(patch).join(', ')}`)
      applied++
      continue
    }

    try {
      const { error } = await supabase
        .from('brands')
        .update(patch)
        .eq('id', brandId)
      if (error) throw error
      applied++
      console.log(`  ${decision.slug.padEnd(30)} patched: ${Object.keys(patch).join(', ')}`)
    } catch (err) {
      failures.push(`${decision.slug}: ${err instanceof Error ? err.message : String(err)}`)
      console.error(`  ${decision.slug.padEnd(30)} FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`\n[apply] ${applied} applied, ${skipped} skipped (no accepted fields), ${failures.length} failed`)
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
  }
}

main().catch(e => { console.error('[apply] fatal:', e); process.exitCode = 1 })
