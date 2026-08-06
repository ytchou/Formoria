/**
 * Temporary operator script: apply the enriched refresh submissions back onto
 * their brands, mirroring approveSubmissionAction's refresh branch
 * (app/admin/actions.ts:119) without the UI.
 *
 * Resolves the reviewer id from ADMIN_EMAILS the same way
 * requestBrandRefreshesBySlugs does.
 *
 * Delete once the hidden-brand re-enrichment backfill is done.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { applyBrandRefresh } from '@/lib/services/submissions'
import { requestPublicBrandRevalidation } from '@/lib/cache/revalidate-client'

const DRY_RUN = process.argv.includes('--dry-run')

async function resolveReviewerId(email: string): Promise<string> {
  const supabase = createServiceClient()
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1_000 })
    if (error) throw error
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
    if (match) return match.id
    if (data.users.length < 1_000) break
  }
  throw new Error(`Admin user not found: ${email}`)
}

async function main(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAILS?.split(',')
    .map((value) => value.trim())
    .find(Boolean)
  if (!adminEmail) throw new Error('ADMIN_EMAILS must contain an admin account')

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_submissions')
    .select('id, brand_name, brand_id')
    .eq('intent', 'refresh')
    .eq('status', 'pending')
    .order('brand_name')
  if (error) throw error

  const submissions = data ?? []
  console.log(`[apply-refresh] ${submissions.length} pending refresh submissions`)
  if (DRY_RUN) {
    console.log('[apply-refresh] dry run — nothing applied')
    return
  }

  const reviewerId = await resolveReviewerId(adminEmail)
  let applied = 0
  const failures: string[] = []
  const appliedBrandIds: string[] = []

  for (const submission of submissions) {
    try {
      const result = await applyBrandRefresh(submission.id, reviewerId)
      applied += 1
      if (result.brandId) appliedBrandIds.push(result.brandId)
      if (result.cleanupFailed) {
        console.warn(`[apply-refresh] ${submission.brand_name}: storage cleanup failed`)
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? JSON.stringify(err)
            : String(err)
      failures.push(`${submission.brand_name}: ${message}`)
    }
  }

  console.log(`[apply-refresh] applied ${applied}, failed ${failures.length}`)
  for (const failure of failures) console.log(`  ${failure}`)

  await revalidateAppliedBrands(appliedBrandIds)
}

/**
 * The refreshes above ran outside a Next request, so nothing invalidated the
 * public ISR entries. Ask the live site to do it. Never throws — the writes are
 * already committed and a stale cache is not worth failing the run over.
 */
async function revalidateAppliedBrands(brandIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(brandIds.filter(Boolean))]
  if (uniqueIds.length === 0) return

  const supabase = createServiceClient()
  const { data, error } = await supabase.from('brands').select('slug').in('id', uniqueIds)
  if (error) {
    console.warn(`[apply-refresh] slug lookup for revalidation failed: ${error.message}`)
    return
  }

  const slugs = (data ?? []).map((row) => row.slug).filter(Boolean)
  const result = await requestPublicBrandRevalidation(slugs)
  if (result.ok) {
    console.log(`[apply-refresh] revalidated ${slugs.length} brand(s)`)
  } else {
    console.warn(`[apply-refresh] revalidation skipped: ${result.reason ?? 'unknown'}`)
  }
}

void main().catch((err) => {
  console.error('[apply-refresh] fatal:', err)
  process.exitCode = 1
})
