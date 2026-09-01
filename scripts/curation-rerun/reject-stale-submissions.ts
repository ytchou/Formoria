/**
 * Pre-step for the population run: rejects any existing pending refresh
 * submissions for brands in the given cohort, so refresh.ts creates fresh
 * ones with current base_brand_data.
 *
 * Without this, refresh.ts reuses stale submissions whose base_brand_data
 * no longer matches the brand (because earlier pipeline runs modified it),
 * and apply_brand_refresh rejects them as "Refresh is stale".
 *
 * Usage:
 *   pnpm exec tsx scripts/curation-rerun/reject-stale-submissions.ts --cohort dev-1616-stationery
 *   pnpm exec tsx scripts/curation-rerun/reject-stale-submissions.ts --cohort dev-1616-stationery --dry-run
 */
import { createClient } from '@supabase/supabase-js'
import { loadCohort } from './cohort'

const DRY_RUN = process.argv.includes('--dry-run')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, key)

async function main() {
  const cohort = await loadCohort()
  const slugs = cohort.slugs

  const { data: brands, error: brandsError } = await supabase
    .from('brands')
    .select('id, slug')
    .in('slug', slugs)
  if (brandsError) throw brandsError

  const brandIds = (brands ?? []).map((b) => b.id)
  if (brandIds.length === 0) {
    console.log(`[reject-stale] no brands found for cohort ${cohort.name}`)
    return
  }

  const { data: pending, error: pendingError } = await supabase
    .from('brand_submissions')
    .select('id, brand_name')
    .eq('intent', 'refresh')
    .eq('status', 'pending')
    .in('brand_id', brandIds)
  if (pendingError) throw pendingError

  const submissions = pending ?? []
  if (submissions.length === 0) {
    console.log(`[reject-stale] no pending submissions for ${cohort.name} (${slugs.length} brands)`)
    return
  }

  console.log(`[reject-stale] ${submissions.length} pending submission(s) for cohort ${cohort.name}`)

  if (DRY_RUN) {
    for (const s of submissions) console.log(`  would reject: ${s.brand_name}`)
    console.log('[reject-stale] dry run — nothing changed')
    return
  }

  const ids = submissions.map((s) => s.id)
  const { error: updateError } = await supabase
    .from('brand_submissions')
    .update({ status: 'rejected' })
    .in('id', ids)
  if (updateError) throw updateError

  for (const s of submissions) console.log(`  rejected: ${s.brand_name}`)
  console.log(`[reject-stale] rejected ${submissions.length} stale submission(s)`)
}

main().catch((err) => {
  console.error('[reject-stale] fatal:', err)
  process.exitCode = 1
})
