import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

const STALE_JOB_MINUTES = 30
const STALE_PENDING_JOB_MINUTES = 60

export type CurationJobParams = Record<string, Json | undefined> & {
  slugs?: string[]
  submissionIds?: string[]
  stopAfter?: number
  phases?: string[]
  status?: string
}

export type CurationJob = {
  id: string
  operation: 'enrich'
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

type CreateCurationJobParams = {
  operation: string
  params: Json
  dryRun: boolean
  startedBy: string
}

type CreateCurationJobResult =
  | { job: CurationJob }
  | { error: string }

export async function checkForRunningJob(): Promise<{ hasRunningJob: boolean; error?: string }> {
  const supabase = createServiceClient()
  const { data: runningJob, error } = await supabase
    .from('curation_jobs')
    .select('id')
    .eq('status', 'running')
    .limit(1)
    .maybeSingle()

  if (error) {
    return { hasRunningJob: false, error: error.message }
  }

  return { hasRunningJob: Boolean(runningJob) }
}

export async function recoverStaleJobs(excludeJobId?: string): Promise<void> {
  const supabase = createServiceClient()
  const staleBefore = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000).toISOString()
  const pendingStaleBefore = new Date(
    Date.now() - STALE_PENDING_JOB_MINUTES * 60 * 1000
  ).toISOString()

  let query = supabase
    .from('curation_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { error: 'Job timed out (stale recovery)' } as Json,
    })

  if (excludeJobId) {
    query = query.neq('id', excludeJobId)
  }

  const { error } = await query.or(
    `and(status.eq.running,started_at.lt.${staleBefore}),and(status.eq.pending,created_at.lt.${pendingStaleBefore})`
  )

  if (error) {
    throw error
  }
}

export async function getNextPendingJob(): Promise<CurationJob | null> {
  const supabase = createServiceClient()
  const { data: job, error } = await supabase
    .from('curation_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return job ? (job as CurationJob) : null
}

export async function createCurationJob(
  params: CreateCurationJobParams
): Promise<CreateCurationJobResult> {
  const supabase = createServiceClient()
  const { data: job, error } = await supabase
    .from('curation_jobs')
    .insert({
      operation: params.operation,
      params: params.params,
      dry_run: params.dryRun,
      status: 'pending',
      started_by: params.startedBy,
    })
    .select('*')
    .single()

  if (error) {
    return { error: error.message }
  }

  return { job: job as CurationJob }
}

export async function cancelCurationJob(jobId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('curation_jobs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    throw error
  }
}

export async function listCurationJobs(
  options?: { limit?: number }
): Promise<CurationJob[]> {
  const supabase = createServiceClient()
  const { data: jobs, error } = await supabase
    .from('curation_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 100)

  if (error) throw error

  return (jobs ?? []) as CurationJob[]
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export function splitIntoBatches(
  params: CurationJobParams,
  batchSize: number
): CurationJobParams[] {
  const submissionIdChunks =
    params.submissionIds && params.submissionIds.length > 0
      ? chunk(params.submissionIds, batchSize)
      : null

  const slugChunks =
    params.slugs && params.slugs.length > 0 ? chunk(params.slugs, batchSize) : null

  if (!submissionIdChunks && !slugChunks) {
    return [params]
  }

  const count = Math.max(submissionIdChunks?.length ?? 0, slugChunks?.length ?? 0)

  return Array.from({ length: count }, (_, i) => {
    const batch: CurationJobParams = { ...params }
    if (submissionIdChunks) batch.submissionIds = submissionIdChunks[i] ?? []
    if (slugChunks) batch.slugs = slugChunks[i] ?? []
    return batch
  })
}
