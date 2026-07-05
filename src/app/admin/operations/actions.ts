'use server'

import { requireAdminAction } from '@/lib/auth/require-admin'
import {
  cancelCurationJob,
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

type CurationOperation = 'enrich'
type StartCurationOperation = CurationOperation | 'clean-names'
type StartCurationJobResult =
  | { jobId: string; jobIds: string[]; summary: EnrichmentSummary }
  | { jobIds: string[]; queued: true; message: string }
  | { error: string }

export async function startCurationJobAction(
  operation: StartCurationOperation,
  params: CurationJobParams,
  dryRun: boolean
): Promise<StartCurationJobResult> {
  try {
    const auth = await requireAdminAction()
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
        startedBy: auth.user.email ?? '',
      })

      if ('error' in createdJob) {
        await Promise.all(jobs.map((j) => cancelCurationJob(j.id)))
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

    return { jobId: jobs[0].id, jobIds: jobs.map((j) => j.id), summary }
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
    const auth = await requireAdminAction()
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
