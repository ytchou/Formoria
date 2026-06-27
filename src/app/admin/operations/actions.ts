'use server'

import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listCurationJobs } from '@/lib/services/curation-jobs'
import { runJob, type CurationJob as RunnerCurationJob } from '@/lib/services/job-runner'
import type { EnrichmentSummary } from '@/lib/services/enrichment-logger'
import type { Json } from '@/lib/supabase/database.types'

export type CurationJobParams = Record<string, Json | undefined> & {
  slugs?: string[]
  submissionIds?: string[]
  stopAfter?: number
  phases?: string[]
  status?: string
}

export type CurationOperation = 'enrich'
type StartCurationOperation = CurationOperation | 'clean-names'

export type CurationJob = {
  id: string
  operation: CurationOperation
  status: 'pending' | 'running' | 'completed' | 'failed'
  params: Json | null
  dry_run: boolean
  progress: Json | null
  result: Json | null
  started_by: string
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}

async function requireAdmin(): Promise<{ userId: string; email: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: 'You must authenticate to perform this action' }
  }

  if (!(await isActingAsAdmin(user.email))) {
    return { error: 'You are not authorized to perform this action' }
  }

  return { userId: user.id, email: user.email ?? '' }
}

export async function startCurationJobAction(
  operation: StartCurationOperation,
  params: CurationJobParams,
  dryRun: boolean
): Promise<{ jobId: string; summary: EnrichmentSummary } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const supabase = createServiceClient()
    const { data: runningJob, error: runningError } = await supabase
      .from('curation_jobs')
      .select('id')
      .in('status', ['pending', 'running'])
      .maybeSingle()

    if (runningError) {
      return { error: runningError.message }
    }

    if (runningJob) {
      return { error: 'A curation job is already running' }
    }

    const { data: job, error: insertError } = await supabase
      .from('curation_jobs')
      .insert({
        operation,
        params,
        dry_run: dryRun,
        status: 'pending',
        started_by: auth.email,
      })
      .select('*')
      .single()

    if (insertError) {
      return { error: insertError.message }
    }

    const summary = await runJob(job as RunnerCurationJob)

    return { jobId: job.id, summary }
  } catch (err) {
    console.error('[admin:startCurationJobAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function getCurationJobAction(
  jobId: string
): Promise<{ job: CurationJob | null } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const supabase = createServiceClient()
    const { data: job, error } = await supabase
      .from('curation_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error) {
      return { error: error.message }
    }

    return { job: job as CurationJob }
  } catch (err) {
    console.error('[admin:getCurationJobAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}

export async function listCurationJobsAction(
  options?: { limit?: number }
): Promise<{ jobs: CurationJob[] } | { error: string }> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    const jobs = await listCurationJobs(options)

    return { jobs }
  } catch (err) {
    console.error('[admin:listCurationJobsAction]', err)
    return {
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    }
  }
}
