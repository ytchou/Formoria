/**
 * Runs the REAL curation pipeline end-to-end against a cohort of live
 * production brands.
 *
 * This is the production path, not a reimplementation of it. Brand-target
 * enrichment is retired (`runEnrich` throws on `target: 'brands'`), so the only
 * supported way to update a live brand is the three-step refresh flow the admin
 * UI uses:
 *
 *   1. `request_brand_refresh`   — snapshots the brand into a pending refresh
 *                                  submission (intent='refresh', brand_id set)
 *   2. a real curation JOB       — enqueue, claim, `runJob`
 *   3. `apply_brand_refresh`     — writes the enriched result back onto the
 *                                  brand and retires replaced images
 *
 * Step 2 must be a job, not a bare `runEnrich`. `apply_brand_refresh` reads the
 * latest `curation_job_targets` row for the submission and refuses to apply
 * unless it is `succeeded` — a direct `runEnrich` call enriches the submission
 * correctly but records no target row, so all 15 applies fail with "Refresh
 * must have a successful enrichment run before apply". Learned the hard way.
 *
 * Step 2 runs IN-PROCESS by default: this checkout claims the job and calls
 * `runJob` itself, so the pipeline that executes is the code you are looking
 * at. `--via-worker` instead dispatches the job to the deployed Railway
 * curation worker and polls until it finishes — that runs whatever SHA the
 * service happens to have deployed, which is not necessarily this branch. The
 * curation-worker service has no GitHub source connected (see the DEV-1260
 * note in `Dockerfile.curation-worker`: builds are pushed manually with
 * `railway up`, and `RAILWAY_GIT_COMMIT_SHA` is not injected), so "deployed"
 * cannot be inferred from git. Both paths call the same `runJob`; the only
 * difference is which copy of it, and whose machine has to stay awake.
 *
 * THIS MUTATES PRODUCTION. Take
 * `scripts/curation-rerun/snapshot.ts --out before.json` first; that file is
 * the rollback copy.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/refresh.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/refresh.ts --confirm
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/refresh.ts --cohort batch1-never-curated --confirm --via-worker
 */
import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { enqueueAdminCurationJob, claimCurationJob } from '@/lib/services/curation-jobs'
import { dispatchCurationJob } from '@/lib/services/curation-dispatch'
import { runJob } from '@/lib/services/job-runner'
import { requestBrandRefreshesBySlugs, applyBrandRefresh } from '@/lib/services/submissions'
import { loadCohort, snapshotDir, type Cohort } from './cohort'

const STEPS = ['context', 'image', 'detail'] as const

/** Terminal job states: anything else means the worker is still working. */
const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const

const POLL_INTERVAL_MS = 15_000
/**
 * A 227-brand job takes hours, so the ceiling has to be generous. Hitting it
 * means "stop waiting", never "the job died" — the worker is a separate
 * process and keeps going after this script exits.
 */
const POLL_TIMEOUT_MS = 6 * 60 * 60 * 1_000

type RunSummary = { success: number; failed: number; skipped: number }

/**
 * Counts by status via `head: true` count queries rather than fetching rows:
 * PostgREST caps a row response at `max-rows` (1000) and reports the cap as an
 * ordinary short result, so counting fetched rows would quietly understate any
 * cohort past that size.
 */
async function countTargets(
  supabase: SupabaseClient,
  jobId: string,
  status?: string
): Promise<number> {
  let query = supabase
    .from('curation_job_targets')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)
  if (status) query = query.eq('status', status)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/**
 * Dispatches the job to the deployed Railway worker and polls the job row until
 * it reaches a terminal state. Returns the same shape `runJob` does so the
 * caller's [4/4] apply step is identical on both paths.
 */
async function runViaWorker(supabase: SupabaseClient, jobId: string): Promise<RunSummary> {
  await dispatchCurationJob(jobId)
  console.log(`  dispatched to the deployed worker — polling every ${POLL_INTERVAL_MS / 1_000}s`)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    await sleep(POLL_INTERVAL_MS)

    const { data, error } = await supabase
      .from('curation_jobs')
      .select('status')
      .eq('id', jobId)
      .single()
    if (error) throw error
    const status = String((data as { status: unknown } | null)?.status ?? 'unknown')

    const [total, succeeded, failed, skipped] = await Promise.all([
      countTargets(supabase, jobId),
      countTargets(supabase, jobId, 'succeeded'),
      countTargets(supabase, jobId, 'failed'),
      countTargets(supabase, jobId, 'skipped'),
    ])
    console.log(
      `  ${new Date().toISOString().slice(11, 19)} job ${status} — ${succeeded} succeeded, ${failed} failed, ${skipped} skipped of ${total} target(s)`
    )

    if ((TERMINAL_JOB_STATUSES as readonly string[]).includes(status)) {
      if (status !== 'completed') {
        throw new Error(
          `job ${jobId} ended as ${status} — not applying. Inspect curation_job_targets before retrying.`
        )
      }
      return { success: succeeded, failed, skipped }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${POLL_TIMEOUT_MS / 3_600_000}h waiting on job ${jobId} (last status: ${status}). ` +
          `The job may STILL BE RUNNING on the worker — do not re-enqueue. Check the job row, then re-run this ` +
          `script with --confirm once it is terminal: the refresh submissions are reused, not duplicated.`
      )
    }
  }
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv.at(index + 1)
}

/** `--slugs a,b` re-runs a subset of the cohort; absent means the whole cohort. */
function targetSlugs(cohort: Cohort): string[] {
  const raw = argValue('--slugs')
  if (!raw) return [...cohort.slugs]
  const slugs = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = slugs.filter((s) => !cohort.slugs.includes(s))
  if (unknown.length > 0) throw new Error(`slug(s) not in cohort ${cohort.name}: ${unknown.join(', ')}`)
  return slugs
}

async function main(): Promise<void> {
  const cohort = await loadCohort()
  const logPath = resolve(snapshotDir(cohort), `refresh-log-${Date.now()}.json`)
  const dryRun = hasFlag('--dry-run')
  const viaWorker = hasFlag('--via-worker')
  // Enqueue and stop. The deployed worker's drain loop claims the next pending
  // job as soon as it finishes its current one (runQueuedJobs -> claimNextCurationJob),
  // so leaving a job pending IS the queue — no dispatch, no poller, nothing on
  // this machine to keep alive. The trade is that step 4 never runs for these
  // jobs: apply is a separate pass (scripts/apply-refresh-submissions.ts) once
  // the job reaches `completed`.
  const enqueueOnly = hasFlag('--enqueue-only')
  if (!dryRun && !hasFlag('--confirm')) {
    throw new Error(
      `This rewrites ${cohort.slugs.length} production brands (cohort ${cohort.name}). Re-run with --confirm (or --dry-run to preview).`
    )
  }

  const slugs = targetSlugs(cohort)
  console.log(`cohort: ${cohort.name} — ${slugs.length} brand(s)`)
  if (slugs.length !== cohort.slugs.length) console.log(`subset: ${slugs.join(', ')}`)

  const adminEmail = (process.env.ADMIN_EMAILS ?? '').split(',')[0]?.trim()
  if (!adminEmail) throw new Error('ADMIN_EMAILS is empty — cannot attribute the refresh')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // The apply step needs a reviewer id. Resolve it up front: discovering it is
  // missing after the enrich has run would leave 15 orphaned refresh
  // submissions holding a snapshot of production.
  let reviewerId: string | null = null
  for (let page = 1; reviewerId === null; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1_000 })
    if (error) throw error
    reviewerId =
      data.users.find((u) => u.email?.toLowerCase() === adminEmail.toLowerCase())?.id ?? null
    if (data.users.length < 1_000) break
  }
  if (!reviewerId) throw new Error(`Admin user not found in auth: ${adminEmail}`)
  console.log(`reviewer: ${adminEmail}`)

  const { data: brandRows } = await supabase
    .from('brands')
    .select('id, slug')
    .in('slug', slugs)
  const brandIds = (brandRows ?? []).map((b) => (b as { id: string }).id)
  const slugByBrandId = new Map(
    (brandRows ?? []).map((b) => [(b as { id: string }).id, (b as { slug: string }).slug])
  )

  // A refresh submission already open for one of these brands is REUSED, not
  // duplicated: two open refreshes for one brand race on apply, and each one
  // holds its own snapshot of the pre-refresh brand. Reuse also makes this
  // script resumable after a failure in a later step.
  const { data: openRefreshes } = await supabase
    .from('brand_submissions')
    .select('id, brand_id')
    .eq('intent', 'refresh')
    .eq('status', 'pending')
    .in('brand_id', brandIds)
  const existing = new Map(
    (openRefreshes ?? []).map((s) => [
      slugByBrandId.get((s as { brand_id: string }).brand_id) ?? '',
      (s as { id: string }).id,
    ])
  )
  const missingSlugs = slugs.filter((slug) => !existing.has(slug))

  console.log(
    `\n[1/4] refresh submissions — ${existing.size} reused, ${missingSlugs.length} to create${dryRun ? ' (dry run)' : ''}`
  )
  // requestBrandRefreshesBySlugs runs one unbounded Promise.all over its input.
  // That is fine for a 15-brand cohort and not fine for a 227-brand one: every
  // slug becomes a concurrent RPC, and the pool is what breaks first. Chunk it
  // here rather than in the service, so the service keeps its simple contract.
  const REQUEST_CHUNK = 25
  const created: Awaited<ReturnType<typeof requestBrandRefreshesBySlugs>> = []
  for (let i = 0; i < missingSlugs.length; i += REQUEST_CHUNK) {
    const chunk = missingSlugs.slice(i, i + REQUEST_CHUNK)
    created.push(...(await requestBrandRefreshesBySlugs(chunk, adminEmail, { dryRun })))
    if (missingSlugs.length > REQUEST_CHUNK) {
      console.log(`  requested ${Math.min(i + REQUEST_CHUNK, missingSlugs.length)}/${missingSlugs.length}`)
    }
  }
  const failedRequests = created.filter((r) => r.error)
  if (failedRequests.length > 0) {
    for (const r of failedRequests) console.error(`  ${r.slug.padEnd(18)} ERROR ${r.error}`)
    throw new Error(`${failedRequests.length} refresh request(s) failed — aborting before enrich`)
  }
  for (const r of created) if (r.submissionId) existing.set(r.slug, r.submissionId)

  if (dryRun) {
    console.log('\ndry run complete — nothing was written')
    return
  }

  const requested = slugs.map((slug) => ({
    slug,
    submissionId: existing.get(slug) ?? null,
    error: existing.has(slug) ? null : 'no submission',
  }))
  const submissionIds = requested.flatMap((r) => (r.submissionId ? [r.submissionId] : []))
  if (submissionIds.length !== slugs.length) {
    throw new Error(`only ${submissionIds.length}/${slugs.length} refresh submissions available`)
  }
  for (const r of requested) console.log(`  ${r.slug.padEnd(18)} ${r.submissionId}`)

  // One job per chunk. A Railway redeploy restarts the worker, which stops the
  // heartbeat and lets recoverStaleJobs cancel every unfinished target of the
  // RUNNING job — that is how a 218-target run lost 82 brands on 2026-08-02.
  // Chunking bounds that blast radius to the chunk in flight: the rest stay
  // `pending` and are claimed by the drain loop afterwards. Jobs are claimed in
  // created_at order, so chunks run in the order enqueued here.
  const chunkSize = Number.parseInt(argValue('--chunk-size') ?? '', 10)
  const perJob = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : submissionIds.length
  // Steps 3 and 4 handle exactly one job. Chunking without --enqueue-only would
  // run the first chunk and silently strand the rest as pending jobs nobody is
  // waiting on, with no apply — refuse rather than half-run.
  if (perJob < submissionIds.length && !enqueueOnly) {
    throw new Error('--chunk-size requires --enqueue-only (steps 3-4 run a single job)')
  }
  const batches: string[][] = []
  for (let i = 0; i < submissionIds.length; i += perJob) {
    batches.push(submissionIds.slice(i, i + perJob))
  }

  console.log(
    `\n[2/4] enqueueing ${batches.length} curation job(s) — steps: ${STEPS.join(', ')}` +
      (batches.length > 1 ? ` (chunk size ${perJob})` : '')
  )
  const jobIds: string[] = []
  for (const [index, ids] of batches.entries()) {
    const job = await enqueueAdminCurationJob({
      params: { target: 'submissions', submissionIds: ids, steps: [...STEPS], overwrite: true },
      dryRun: false,
      startedBy: adminEmail,
    })
    jobIds.push(job.id)
    console.log(`  [${index + 1}/${batches.length}] job ${job.id} — ${ids.length} target(s)`)
  }
  const job = { id: jobIds.at(0) ?? '' }

  if (enqueueOnly) {
    console.log(
      `\n[3/4] skipped — ${jobIds.length} job(s) left PENDING for the deployed worker to claim.` +
        `\n[4/4] skipped — apply separately once the jobs are completed:` +
        `\n      pnpm exec tsx --env-file=.env.local scripts/apply-refresh-submissions.ts --dry-run\n`
    )
    await mkdir(dirname(logPath), { recursive: true })
    await writeFile(
      logPath,
      JSON.stringify(
        { ranAt: new Date().toISOString(), mode: 'enqueue-only', jobIds, chunkSize: perJob, steps: [...STEPS], requested },
        null,
        2
      )
    )
    console.log(`wrote ${logPath}`)
    return
  }

  console.log(`\n[3/4] running the worker — ${viaWorker ? 'deployed Railway service' : 'in-process (this checkout)'}\n`)
  let summary: RunSummary
  if (viaWorker) {
    summary = await runViaWorker(supabase, job.id)
  } else {
    const workerToken = randomUUID()
    const claimed = await claimCurationJob(job.id, workerToken)
    if (!claimed) throw new Error(`could not claim job ${job.id} — another worker may hold it`)
    summary = await runJob(claimed, workerToken)
  }
  console.log(
    `\njob done — success ${summary.success}, failed ${summary.failed}, skipped ${summary.skipped}`
  )
  const enrich = {
    processed: summary.success + summary.failed + summary.skipped,
    updated: summary.success,
    skipped: summary.skipped,
    errors: [] as unknown[],
  }

  console.log(`\n[4/4] applying ${submissionIds.length} refreshes to live brands\n`)
  const applied: Array<{ slug: string; submissionId: string; ok: boolean; detail: string }> = []
  for (const r of requested) {
    if (!r.submissionId) continue
    try {
      const { cleanupFailed } = await applyBrandRefresh(r.submissionId, reviewerId)
      applied.push({
        slug: r.slug,
        submissionId: r.submissionId,
        ok: true,
        detail: cleanupFailed ? 'applied (storage cleanup failed)' : 'applied',
      })
      console.log(`  ${r.slug.padEnd(18)} applied${cleanupFailed ? ' (storage cleanup failed)' : ''}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : JSON.stringify(err)
      applied.push({ slug: r.slug, submissionId: r.submissionId, ok: false, detail })
      console.error(`  ${r.slug.padEnd(18)} APPLY FAILED — ${detail}`)
    }
  }

  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(
    logPath,
    // `jobIds` is recorded on this path too, not just the enqueue-only one:
    // `render.ts` bills the run by joining `brand_ai_results` on the job, and
    // without it the cost column has to guess which job produced these rows.
    JSON.stringify({ ranAt: new Date().toISOString(), jobIds, steps: [...STEPS], requested, enrich: { processed: enrich.processed, updated: enrich.updated, skipped: enrich.skipped, errors: enrich.errors }, applied }, null, 2)
  )
  const failedApplies = applied.filter((a) => !a.ok)
  console.log(`\nwrote ${logPath}`)
  console.log(`applied ${applied.length - failedApplies.length}/${applied.length}`)
  if (failedApplies.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : JSON.stringify(e))
  process.exitCode = 1
})

export {}
