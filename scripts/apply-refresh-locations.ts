import { createServiceClient } from '@/lib/supabase/service'
import { requestPublicBrandRevalidation } from '@/lib/cache/revalidate-client'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function main(): Promise<void> {
  const submissionIds = [...new Set(process.argv.slice(2))]
  if (
    submissionIds.length === 0 ||
    submissionIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    throw new Error(
      'Usage: pnpm exec tsx --env-file=.env.local scripts/apply-refresh-locations.ts <submission-id> [...]',
    )
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLocaleLowerCase())
    .filter(Boolean)
  if (adminEmails.length === 0) {
    throw new Error('ADMIN_EMAILS must contain an admin account')
  }

  const supabase = createServiceClient()
  // ceiling: breaks at >1000 auth users; paginate if user base grows
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  })
  if (usersError) throw usersError
  const reviewer = adminEmails
    .map((email) => users.users.find((user) => user.email?.toLocaleLowerCase() === email))
    .find(Boolean)
  if (!reviewer) throw new Error('Configured admin user was not found')

  const { data, error } = await supabase.rpc('apply_brand_refresh_locations', {
    p_submission_ids: submissionIds,
    p_reviewer_id: reviewer.id,
  })
  if (error) throw error

  console.log(JSON.stringify(data, null, 2))

  await revalidateAffectedBrands(submissionIds)
}

/**
 * The RPC mutated brand locations outside a Next request, so no ISR entry was
 * invalidated. Ask the live site to do it. Never throws — the RPC already
 * committed and a stale cache is not worth failing the run over.
 */
async function revalidateAffectedBrands(submissionIds: string[]): Promise<void> {
  const supabase = createServiceClient()

  const { data: submissions, error: submissionsError } = await supabase
    .from('brand_submissions')
    .select('brand_id')
    .in('id', submissionIds)
  if (submissionsError) {
    console.warn(
      `[apply-refresh-locations] brand lookup for revalidation failed: ${submissionsError.message}`,
    )
    return
  }

  const brandIds = [
    ...new Set((submissions ?? []).map((row) => row.brand_id).filter((id): id is string => Boolean(id))),
  ]
  if (brandIds.length === 0) return

  const { data: brands, error: brandsError } = await supabase
    .from('brands')
    .select('slug')
    .in('id', brandIds)
  if (brandsError) {
    console.warn(
      `[apply-refresh-locations] slug lookup for revalidation failed: ${brandsError.message}`,
    )
    return
  }

  const slugs = (brands ?? []).map((row) => row.slug).filter(Boolean)
  const result = await requestPublicBrandRevalidation(slugs)
  if (result.ok) {
    console.log(`[apply-refresh-locations] revalidated ${slugs.length} brand(s)`)
  } else {
    console.warn(
      `[apply-refresh-locations] revalidation skipped: ${result.reason ?? 'unknown'}`,
    )
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
