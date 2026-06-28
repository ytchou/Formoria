'use server'

import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'
import {
  checkForRunningJob,
  createCurationJob,
  listCurationJobs,
  recoverStaleJobs,
  splitIntoBatches,
  type CurationJob,
  type CurationJobParams,
} from '@/lib/services/curation-jobs'
import { runJob } from '@/lib/services/job-runner'
import type { EnrichmentSummary } from '@/lib/services/enrichment-logger'

const BATCH_SIZE = 20

export type { CurationJobParams }

export type CurationOperation = 'enrich'
type StartCurationOperation = CurationOperation | 'clean-names'
type StartCurationJobResult =
  | { jobId: string; summary: EnrichmentSummary }
  | { jobIds: string[]; queued: true; message: string }
  | { error: string }

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
): Promise<StartCurationJobResult> {
  try {
    const auth = await requireAdmin()
    if ('error' in auth) return auth

    await recoverStaleJobs()

    const runningJob = await checkForRunningJob()
    if (runningJob.error) {
      return { error: runningJob.error }
    }

    const batches = splitIntoBatches(params, BATCH_SIZE)
    const jobs: CurationJob[] = []

    for (const batch of batches) {
      const createdJob = await createCurationJob({
        operation,
        params: batch,
        dryRun,
        startedBy: auth.email,
      })

      if ('error' in createdJob) {
        return { error: createdJob.error }
      }

      jobs.push(createdJob.job)
    }

    if (runningJob.hasRunningJob) {
      return {
        jobIds: jobs.map((job) => job.id),
        queued: true,
        message: `Queued ${jobs.length} curation ${jobs.length === 1 ? 'job' : 'jobs'}.`,
      }
    }

    const summary = await runJob(jobs[0])

    return { jobId: jobs[0].id, summary }
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
