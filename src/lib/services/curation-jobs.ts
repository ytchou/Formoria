import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

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
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle()

  if (error) {
    return { hasRunningJob: false, error: error.message }
  }

  return { hasRunningJob: Boolean(runningJob) }
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
