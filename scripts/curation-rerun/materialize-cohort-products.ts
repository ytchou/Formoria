/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- operational script with untyped Supabase client */
/**
 * Materializes curated products for all brands in a cohort whose submissions
 * have enriched products but no curated_products rows yet.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/materialize-cohort-products.ts --cohort dev-1616-bags-accessories --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/materialize-cohort-products.ts --cohort dev-1616-bags-accessories --confirm
 */
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { materializeSubmissionCuratedProducts } from '@/lib/services/curated-products/materialize'
import { storeCuratedProductImage } from '@/lib/services/curated-product-image'
import { loadCohort } from './cohort'

const DRY_RUN = process.argv.includes('--dry-run')
const CONFIRM = process.argv.includes('--confirm')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const rawClient = createClient(url, key)

async function main() {
  if (!DRY_RUN && !CONFIRM) throw new Error('Pass --dry-run or --confirm')
  const cohort = await loadCohort()
  const slugs = cohort.slugs

  const { data: brands } = await rawClient.from('brands').select('id, slug').in('slug', slugs)
  const brandIdBySlug = new Map((brands ?? []).map((b: any) => [b.slug, b.id]))
  const slugByBrandId = new Map((brands ?? []).map((b: any) => [b.id, b.slug]))

  // Find submissions with enriched products
  const targets: Array<{ slug: string; submissionId: string; brandId: string; productCount: number }> = []
  for (const [slug, brandId] of brandIdBySlug) {
    const { data: subs } = await rawClient
      .from('brand_submissions')
      .select('id, brand_id, enriched_data')
      .eq('intent', 'refresh')
      .eq('brand_id', brandId)
      .not('enriched_data', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
    const sub = subs?.[0]
    if (!sub) continue
    const products = sub.enriched_data?.products ?? []
    if (products.length > 0) {
      // Check if brand already has curated_products
      const { count } = await rawClient
        .from('curated_products')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
      if ((count ?? 0) === 0) {
        targets.push({ slug, submissionId: sub.id, brandId, productCount: products.length })
      }
    }
  }

  console.log(`[materialize] cohort ${cohort.name}: ${targets.length} brands need materialization (${targets.reduce((s, t) => s + t.productCount, 0)} products), dry-run=${DRY_RUN}\n`)

  if (targets.length === 0) {
    console.log('  (nothing to materialize)')
    return
  }

  if (DRY_RUN) {
    for (const t of targets) {
      console.log(`  ${t.slug.padEnd(30)} ${t.productCount} products (submission ${t.submissionId})`)
    }
    return
  }

  const supabase = createServiceClient()
  let totalVisible = 0
  let totalHidden = 0
  let totalMirrored = 0
  const failures: string[] = []

  for (const t of targets) {
    try {
      const materialized = await materializeSubmissionCuratedProducts(t.submissionId, t.brandId)

      let mirrored = 0
      let mirrorFailed = 0
      const { data: unmirroredProducts } = await supabase
        .from('curated_products')
        .select('id, brand_id, image_source_url')
        .eq('brand_id', t.brandId)
        .eq('visible', true)
        .not('image_source_url', 'is', null)
        .is('image_url', null)

      for (const product of (unmirroredProducts ?? []) as any[]) {
        try {
          const stored = await storeCuratedProductImage({
            brandId: product.brand_id,
            productId: product.id,
            imageSourceUrl: product.image_source_url,
          })
          await supabase
            .from('curated_products')
            .update({
              image_url: stored.url,
              image_width: stored.width,
              image_height: stored.height,
            })
            .eq('id', product.id)
          mirrored += 1
        } catch (err) {
          mirrorFailed += 1
          console.warn(`    mirror failed for product ${product.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      totalVisible += materialized.visible
      totalHidden += materialized.hidden
      totalMirrored += mirrored
      const mirrorNote = mirrorFailed > 0 ? `, ${mirrorFailed} mirror failed` : ''
      console.log(`  ${t.slug.padEnd(30)} ${materialized.visible} visible, ${materialized.hidden} hidden, ${mirrored} mirrored${mirrorNote}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${t.slug}: ${msg}`)
      console.error(`  ${t.slug.padEnd(30)} FAILED: ${msg}`)
    }
  }

  console.log(`\n[materialize] done: ${totalVisible} visible, ${totalHidden} hidden, ${totalMirrored} mirrored`)
  if (failures.length > 0) {
    console.error(`[materialize] ${failures.length} failure(s):`)
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[materialize] fatal:', err)
  process.exitCode = 1
})
