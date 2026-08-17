/**
 * Temporary operator script: enrich a capped batch of pending *refresh*
 * submissions only.
 *
 * Why not the normal paths:
 *   - Admin-triggered jobs refuse refresh intents outright
 *     (curation-jobs.ts:713 "Refresh submissions wait for scheduled enrichment").
 *   - The scheduled/cron path accepts them, but resolvePendingSubmissionTargets
 *     orders by submitted_at ascending, so freshly-created refresh submissions
 *     sit behind every older pending `recommend` submission in the queue.
 *
 * So this enqueues a job with explicit targets via the same enqueue_curation_job
 * RPC that enqueueCurationJob() uses (curation-jobs.ts:104), then claims and runs
 * it. runOperation takes the submissionIds branch (job-runner.ts:196), which
 * queries submissions by id and skips the `brand_id is null` filter that
 * otherwise excludes refreshes.
 *
 * Usage: REFRESH_LIMIT=40 pnpm exec tsx --env-file=.env.local scripts/run-refresh-enrichment.ts
 *
 * Delete once the hidden-brand re-enrichment backfill is done.
 */
import { randomUUID } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/service'
import { claimCurationJob, getCurationJob } from '@/lib/services/curation-jobs'
import { runJob } from '@/lib/services/job-runner'

const LIMIT = Number.parseInt(process.env.REFRESH_LIMIT ?? '40', 10)

async function main(): Promise<void> {
  const startedAt = Date.now()
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('brand_submissions')
    .select('id, brand_name, brand_id')
    .eq('intent', 'refresh')
    .eq('status', 'pending')
    .order('brand_name')
  if (error) throw error

  // Skip submissions already settled by an earlier job so a re-run makes progress.
  const all = data ?? []
  const { data: settled, error: settledError } = await supabase
    .from('curation_job_targets')
    .select('target_id, status')
    .eq('target_type', 'submission')
    .in('status', ['succeeded', 'skipped'])
  if (settledError) throw settledError
  const done = new Set((settled ?? []).map((row) => row.target_id))

  const todo = all.filter((submission) => !done.has(submission.id)).slice(0, LIMIT)
  console.log(
    `[refresh-enrichment] ${all.length} pending refresh, ${done.size} already settled, running ${todo.length}`
  )
  if (todo.length === 0) return

  const { data: jobId, error: enqueueError } = await supabase.rpc('enqueue_curation_job', {
    p_operation: 'enrich',
    p_params: { submissionIds: todo.map((submission) => submission.id) },
    p_dry_run: false,
    p_started_by: 'operator-backfill',
    p_trigger: 'admin',
    p_parent_job_id: null,
    p_attempt: 1,
    p_scheduled_for: null,
    p_run_after: new Date().toISOString(),
    p_dedupe_key: null,
    p_targets: todo.map((submission) => ({
      target_type: 'submission',
      target_id: submission.id,
      brand_name: submission.brand_name,
      brand_slug: null,
    })),
  })
  if (enqueueError) throw enqueueError

  const job = await getCurationJob(jobId as string)
  console.log(`[refresh-enrichment] enqueued ${job.id} with ${todo.length} targets`)

  const workerToken = randomUUID()
  const claimed = await claimCurationJob(job.id, workerToken)
  if (!claimed) throw new Error(`Could not claim job ${job.id}`)

  const summary = await runJob(claimed, workerToken)
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  console.log(`[refresh-enrichment] done in ${minutes}m — ${JSON.stringify(summary)}`)
}

void main().catch((err) => {
  console.error('[refresh-enrichment] fatal:', err)
  process.exitCode = 1
})
