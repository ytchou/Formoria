/**
 * Extracts enriched submission data for the review artifact.
 * Outputs JSON to stdout in the shape the artifact expects.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/extract-review-data.ts --cohort dev-1616-bags-accessories
 */
import { createClient } from '@supabase/supabase-js'
import { loadCohort } from './cohort'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key)

const DIFF_FIELDS = [
  { db: 'name', label: 'name' },
  { db: 'blurb', label: 'blurb' },
  { db: 'blurb_en', label: 'blurb_en' },
  { db: 'description', label: 'description' },
  { db: 'description_en', label: 'description_en' },
  { db: 'category', label: 'category' },
  { db: 'subcategories', label: 'subcategories' },
  { db: 'subcategories_en', label: 'subcategories_en' },
  { db: 'founding_year', label: 'founding_year' },
  { db: 'hero_image_storage_path', label: 'hero_image_storage_path' },
  { db: 'purchase_website', label: 'purchase_website' },
  { db: 'purchase_pinkoi', label: 'purchase_pinkoi' },
  { db: 'purchase_shopee', label: 'purchase_shopee' },
  { db: 'purchase_myship', label: 'purchase_myship' },
  { db: 'social_instagram', label: 'social_instagram' },
  { db: 'social_facebook', label: 'social_facebook' },
  { db: 'social_threads', label: 'social_threads' },
] as const

function normalize(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (Array.isArray(val)) return JSON.stringify(val)
  return String(val)
}

async function main() {
  const cohort = await loadCohort()
  const slugs = cohort.slugs

  // Get brands
  const { data: brands, error: brandsErr } = await supabase
    .from('brands')
    .select('*')
    .in('slug', slugs)
  if (brandsErr) throw brandsErr

  const brandBySlug = new Map((brands ?? []).map((b: any) => [b.slug, b]))
  const brandById = new Map((brands ?? []).map((b: any) => [b.id, b]))

  const brandIds = (brands ?? []).map((b: any) => b.id)

  // Get ALL approved/pending refresh submissions for these brands
  const { data: subs, error: subsErr } = await supabase
    .from('brand_submissions')
    .select('id, brand_id, brand_name, status, enriched_data, submitted_at')
    .eq('intent', 'refresh')
    .in('status', ['pending', 'approved'])
    .in('brand_id', brandIds)
    .order('submitted_at', { ascending: false })
  if (subsErr) throw subsErr

  // Pick the latest submission per brand that has enriched_data
  const latestByBrandId = new Map<string, any>()
  for (const s of (subs ?? []) as any[]) {
    if (latestByBrandId.has(s.brand_id)) continue
    if (s.enriched_data && Object.keys(s.enriched_data).length > 0) {
      latestByBrandId.set(s.brand_id, s)
    }
  }

  const result: any[] = []

  for (const slug of slugs) {
    const brand = brandBySlug.get(slug)
    if (!brand) {
      console.error(`[extract] brand not found: ${slug}`)
      continue
    }

    const sub = latestByBrandId.get(brand.id)
    if (!sub) {
      console.error(`[extract] no enriched submission for: ${slug}`)
      continue
    }

    const enriched = sub.enriched_data ?? {}
    const products = enriched.products ?? []

    const diffs: any[] = []
    let totalChanged = 0

    for (const field of DIFF_FIELDS) {
      const current = normalize(brand[field.db])
      const proposed = normalize(enriched[field.db] ?? brand[field.db])
      const changed = current !== proposed
      if (changed) totalChanged++
      diffs.push({ field: field.label, current, proposed, changed })
    }

    result.push({
      submission_id: sub.id,
      brand_id: brand.id,
      brand_name: sub.brand_name || brand.name,
      slug,
      product_count: products.length,
      diffs,
      total_changed: totalChanged,
      total_fields: DIFF_FIELDS.length,
      already_applied: false,
    })
  }

  // Output to stdout
  process.stdout.write(JSON.stringify(result))
}

main().catch((err) => {
  console.error('[extract] fatal:', err)
  process.exitCode = 1
})
