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
