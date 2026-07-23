import { createServiceClient } from '@/lib/supabase/server'

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
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  })
  if (usersError) throw usersError
  const reviewer = users.users.find(
    (user) =>
      user.email && adminEmails.includes(user.email.toLocaleLowerCase()),
  )
  if (!reviewer) throw new Error('Configured admin user was not found')

  const { data, error } = await supabase.rpc('apply_brand_refresh_locations', {
    p_submission_ids: submissionIds,
    p_reviewer_id: reviewer.id,
  })
  if (error) throw error

  console.log(JSON.stringify(data, null, 2))
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
