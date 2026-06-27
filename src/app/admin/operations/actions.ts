'use server'

import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'
import {
  checkForRunningJob,
  createCurationJob,
  listCurationJobs,
  type CurationJob,
} from '@/lib/services/curation-jobs'
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

    const runningJob = await checkForRunningJob()
    if (runningJob.error) {
      return { error: runningJob.error }
    }

    if (runningJob.hasRunningJob) {
      return { error: 'A curation job is already running' }
    }

    const createdJob = await createCurationJob({
      operation,
      params,
      dryRun,
      startedBy: auth.email,
    })

    if ('error' in createdJob) {
      return { error: createdJob.error }
    }

    const summary = await runJob(createdJob.job as RunnerCurationJob)

    return { jobId: createdJob.job.id, summary }
  } catch (err) {
    console.error('[admin:startCurationJobAction]', err)
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
