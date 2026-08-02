/**
 * Runs the REAL curation pipeline end-to-end against 15 live production brands.
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
 * THIS MUTATES PRODUCTION. Take `scripts/expo15/snapshot.ts --out before.json`
 * first; that file is the rollback copy.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/expo15/refresh.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/expo15/refresh.ts --confirm
 */
import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { enqueueAdminCurationJob, claimCurationJob } from '@/lib/services/curation-jobs'
import { runJob } from '@/lib/services/job-runner'
import { requestBrandRefreshesBySlugs, applyBrandRefresh } from '@/lib/services/submissions'
import { EXPO15_SLUGS } from './brands'

const STEPS = ['context', 'image', 'detail'] as const
const LOG_PATH = resolve('scripts/expo15/snapshots', `refresh-log-${Date.now()}.json`)

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv.at(index + 1)
}

/** `--slugs a,b` re-runs a subset; absent means all 15. */
function targetSlugs(): string[] {
  const raw = argValue('--slugs')
  if (!raw) return [...EXPO15_SLUGS]
  const slugs = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = slugs.filter((s) => !EXPO15_SLUGS.includes(s as (typeof EXPO15_SLUGS)[number]))
  if (unknown.length > 0) throw new Error(`unknown slug(s): ${unknown.join(', ')}`)
  return slugs
}

async function main(): Promise<void> {
  const dryRun = hasFlag('--dry-run')
  if (!dryRun && !hasFlag('--confirm')) {
    throw new Error(
      'This rewrites 15 production brands. Re-run with --confirm (or --dry-run to preview).'
    )
  }

  const slugs = targetSlugs()
  if (slugs.length !== EXPO15_SLUGS.length) console.log(`subset: ${slugs.join(', ')}`)

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
  const created = missingSlugs.length > 0
    ? await requestBrandRefreshesBySlugs(missingSlugs, adminEmail, { dryRun })
    : []
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

  console.log(`\n[2/4] enqueueing a curation job — steps: ${STEPS.join(', ')}`)
  const job = await enqueueAdminCurationJob({
    params: { target: 'submissions', submissionIds, steps: [...STEPS], overwrite: true },
    dryRun: false,
    startedBy: adminEmail,
  })
  console.log(`  job ${job.id}`)

  console.log(`\n[3/4] running the worker\n`)
  const workerToken = randomUUID()
  const claimed = await claimCurationJob(job.id, workerToken)
  if (!claimed) throw new Error(`could not claim job ${job.id} — another worker may hold it`)
  const summary = await runJob(claimed, workerToken)
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

  await mkdir(dirname(LOG_PATH), { recursive: true })
  await writeFile(
    LOG_PATH,
    JSON.stringify({ ranAt: new Date().toISOString(), steps: [...STEPS], requested, enrich: { processed: enrich.processed, updated: enrich.updated, skipped: enrich.skipped, errors: enrich.errors }, applied }, null, 2)
  )
  const failedApplies = applied.filter((a) => !a.ok)
  console.log(`\nwrote ${LOG_PATH}`)
  console.log(`applied ${applied.length - failedApplies.length}/${applied.length}`)
  if (failedApplies.length > 0) process.exitCode = 1
}

void main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : JSON.stringify(e))
  process.exitCode = 1
})

export {}
