import { NextResponse } from 'next/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { fetchJob, runJob } from '@/lib/services/job-runner'
import { createClient } from '@/lib/supabase/server'

export { VALID_OPERATIONS, DEPRECATED_OPERATIONS } from '@/lib/services/job-runner'

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let jobId: unknown

  try {
    const body = await request.json()
    jobId = body?.jobId
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof jobId !== 'string' || jobId.trim() === '') {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  const { data: job, error } = await fetchJob(jobId)

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Job not found' }, { status: 404 })
  }

  runJob(job).catch((err) => {
    console.error('[admin:run-job]', err)
  })

  return NextResponse.json({ jobId: job.id, status: 'accepted' }, { status: 202 })
}

async function requireAdmin(): Promise<
  { userId: string; email: string } | { error: string; status: number }
> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: 'You must authenticate to perform this action', status: 401 }
  }

  if (!(await isActingAsAdmin(user.email))) {
    return { error: 'You are not authorized to perform this action', status: 403 }
  }

  return { userId: user.id, email: user.email ?? '' }
}
