import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import {
  claimCurationDispatchWork,
  enqueueAutomaticRetry,
  enqueueManualRerun,
  ensureAutomaticRetries,
  finalizeCurationJob,
  getCurationJob,
} from '../curation-jobs'
import { requestCuratedProductBackfill } from '../curated-products/backfill'

const createdJobIds = new Set<string>()

describeWithDb('durable curation job queue integration', () => {
  afterEach(async () => {
    const client = createTestClient()
    for (const id of createdJobIds) {
      await client.from('curation_jobs').delete().eq('id', id)
    }
    createdJobIds.clear()
  })

  it('rolls back the job when inserting its target snapshot fails', async () => {
    const client = createTestClient()
    const dedupeKey = `integration-invalid-target:${randomUUID()}`
    const { error } = await client.rpc(
      'enqueue_curation_job',
      enqueueArgs({
        dedupeKey,
        targets: [
          {
            target_type: 'not-a-target',
            target_id: randomUUID(),
            brand_name: '不合法目標',
            brand_slug: null,
          },
        ],
      })
    )

    expect(error).not.toBeNull()
    const { data } = await client.from('curation_jobs').select('id').eq('dedupe_key', dedupeKey)
    expect(data).toEqual([])
  })

  it('deduplicates concurrent scheduler calls for the same slot', async () => {
    const client = createTestClient()
    const dedupeKey = `submission-enrichment:2099-01-01T16:00:00.000Z:${randomUUID()}`
    const args = enqueueArgs({ dedupeKey })

    const [first, second] = await Promise.all([
      client.rpc('enqueue_curation_job', args),
      client.rpc('enqueue_curation_job', args),
    ])

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(first.data).toBe(second.data)
    createdJobIds.add(first.data!)
    const { count } = await client
      .from('curation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('dedupe_key', dedupeKey)
    expect(count).toBe(1)
  })

  it('allows only one concurrent worker claim and fences finalization by token', async () => {
    const client = createTestClient()
    const firstJobId = await enqueue(client, {
      runAfter: '2000-01-01T00:00:00.000Z',
    })
    await enqueue(client, { runAfter: '2000-01-01T00:00:01.000Z' })
    const firstToken = randomUUID()
    const secondToken = randomUUID()

    const [firstClaim, secondClaim] = await Promise.all([
      client.rpc('claim_next_curation_job', { p_worker_token: firstToken }),
      client.rpc('claim_next_curation_job', { p_worker_token: secondToken }),
    ])

    expect(firstClaim.error).toBeNull()
    expect(secondClaim.error).toBeNull()
    const claimed = [...(firstClaim.data ?? []), ...(secondClaim.data ?? [])]
    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.id).toBe(firstJobId)

    await expect(
      finalizeCurationJob(firstJobId, randomUUID(), {
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
    ).resolves.toBe(false)
    await expect(
      finalizeCurationJob(firstJobId, claimed[0]!.worker_token!, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
    ).resolves.toBe(true)
  })

  it('runs due admin jobs in FIFO order after the active job completes', async () => {
    const client = createTestClient()
    const firstJobId = await enqueue(client, {
      runAfter: '2000-01-01T00:00:00.000Z',
    })
    const secondJobId = await enqueue(client, {
      runAfter: '2000-01-01T00:00:01.000Z',
    })
    const thirdJobId = await enqueue(client, {
      runAfter: '2000-01-01T00:00:02.000Z',
    })
    const firstToken = randomUUID()
    const secondToken = randomUUID()

    const { data: firstClaim, error: firstClaimError } = await client.rpc(
      'claim_curation_job',
      { p_job_id: firstJobId, p_worker_token: firstToken }
    )
    expect(firstClaimError).toBeNull()
    expect(firstClaim?.[0]?.id).toBe(firstJobId)

    const { data: queuedJob, error: queuedJobError } = await client
      .from('curation_jobs')
      .select('status, created_at, started_at')
      .eq('id', secondJobId)
      .single()
    expect(queuedJobError).toBeNull()
    expect(queuedJob).toMatchObject({ status: 'pending', started_at: null })

    await expect(
      finalizeCurationJob(firstJobId, firstToken, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
    ).resolves.toBe(true)

    const dispatch = await claimCurationDispatchWork(thirdJobId, secondToken)
    expect(dispatch?.requestedJob.id).toBe(thirdJobId)
    expect(dispatch?.claimedJob?.id).toBe(secondJobId)
    expect(new Date(dispatch!.claimedJob!.started_at!).getTime()).toBeGreaterThan(
      new Date(queuedJob!.created_at).getTime()
    )
  })

  it('recovers stale runs as cancelled without scheduling a retry', async () => {
    const client = createTestClient()
    const parentId = await enqueue(client, {
      trigger: 'cron',
      runAfter: '1999-01-01T00:00:00.000Z',
    })
    const workerToken = randomUUID()
    const { data: claims, error: claimError } = await client.rpc('claim_next_curation_job', {
      p_worker_token: workerToken,
    })
    expect(claimError).toBeNull()
    expect(claims?.[0]?.id).toBe(parentId)

    await client
      .from('curation_jobs')
      .update({ heartbeat_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', parentId)
    const { data: recovered, error: recoveryError } = await client.rpc(
      'recover_stale_curation_jobs',
      {
        p_stale_before: '2001-01-01T00:00:00.000Z',
      }
    )
    expect(recoveryError).toBeNull()
    expect(recovered?.map((job: { id: string }) => job.id)).toContain(parentId)
    expect(recovered?.find((job: { id: string }) => job.id === parentId)?.status).toBe('cancelled')
    const { data: targets } = await client
      .from('curation_job_targets')
      .select('status')
      .eq('job_id', parentId)
    expect(targets?.every((target) => target.status === 'cancelled')).toBe(true)
    const { count: retryCount } = await client
      .from('curation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('parent_job_id', parentId)
      .eq('trigger', 'automatic_retry')
    expect(retryCount).toBe(0)
  })

  it('fences progress and finalization after an active job is cancelled', async () => {
    const client = createTestClient()
    const jobId = await enqueue(client, {
      runAfter: '2000-01-01T00:00:00.000Z',
    })
    const workerToken = randomUUID()
    const { data: claimed } = await client.rpc('claim_next_curation_job', {
      p_worker_token: workerToken,
    })
    expect(claimed?.[0]?.id).toBe(jobId)

    const { data: cancelled, error: cancelError } = await client.rpc('cancel_curation_job', {
      p_job_id: jobId,
      p_reason: 'Integration cancellation',
    })
    expect(cancelError).toBeNull()
    expect(cancelled?.[0]?.status).toBe('cancelled')

    const { data: progressAccepted } = await client.rpc('persist_curation_job_target_progress', {
      p_job_id: jobId,
      p_worker_token: workerToken,
      p_updates: [],
      p_current_target_id: null,
      p_current_phase: null,
    })
    expect(progressAccepted).toBe(false)
    await expect(
      finalizeCurationJob(jobId, workerToken, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
    ).resolves.toBe(false)
  })

  it('creates a manual rerun for a completed job with a skipped submission', async () => {
    const client = createTestClient()
    const sourceJobId = await enqueue(client)
    const completedAt = new Date().toISOString()
    await client
      .from('curation_job_targets')
      .update({ status: 'skipped', completed_at: completedAt })
      .eq('job_id', sourceJobId)
    await client
      .from('curation_jobs')
      .update({ status: 'completed', completed_at: completedAt })
      .eq('id', sourceJobId)

    const rerun = await enqueueManualRerun(sourceJobId, 'm.garcia+test@company.co.uk')
    createdJobIds.add(rerun.id)

    const { data: targets, error } = await client
      .from('curation_job_targets')
      .select('status, target_type')
      .eq('job_id', rerun.id)

    expect(error).toBeNull()
    expect(rerun.parent_job_id).toBe(sourceJobId)
    expect(rerun.trigger).toBe('manual_rerun')
    expect(new Date(rerun.run_after).getTime()).toBeLessThan(Date.now() + 5_000)
    expect(targets).toEqual([{ status: 'pending', target_type: 'submission' }])
  })

  it('requeues automatic failures with tiered backoff and stops at the cap', async () => {
    const client = createTestClient()
    const firstJobId = await enqueue(client)
    await failJob(client, firstJobId)

    const firstStartedAt = Date.now()
    const firstRetry = await enqueueAutomaticRetry(await getCurationJob(firstJobId))
    expect(firstRetry).not.toBeNull()
    createdJobIds.add(firstRetry!.id)
    expect(firstRetry!.attempt).toBe(2)
    const firstDelay = new Date(firstRetry!.run_after).getTime() - firstStartedAt
    expect(firstDelay).toBeGreaterThanOrEqual(60_000)

    await failJob(client, firstRetry!.id)
    const secondStartedAt = Date.now()
    const secondRetry = await enqueueAutomaticRetry(await getCurationJob(firstRetry!.id))
    expect(secondRetry).not.toBeNull()
    createdJobIds.add(secondRetry!.id)
    expect(secondRetry!.attempt).toBe(3)
    const secondDelay = new Date(secondRetry!.run_after).getTime() - secondStartedAt
    expect(secondDelay).toBeGreaterThan(firstDelay)

    await failJob(client, secondRetry!.id)
    await expect(enqueueAutomaticRetry(await getCurationJob(secondRetry!.id))).resolves.toBeNull()
  })

  it('ensureAutomaticRetries picks up failed jobs below the attempt cap', async () => {
    const client = createTestClient()
    const firstJobId = await enqueue(client)
    await failJob(client, firstJobId)
    const firstRetry = await enqueueAutomaticRetry(await getCurationJob(firstJobId))
    expect(firstRetry).not.toBeNull()
    createdJobIds.add(firstRetry!.id)

    await failJob(client, firstRetry!.id)
    const retries = await ensureAutomaticRetries()

    expect(retries.some((job) => job.parent_job_id === firstRetry!.id && job.attempt === 3)).toBe(
      true,
    )
  })

  /**
   * DEV-1469 — the curated-product backfill entry point.
   *
   * It composes two existing primitives and adds no new ones: one
   * `request_brand_refresh` per brand (three real arguments, no phase argument —
   * the RPC has none), then ONE curation job whose params carry the phase scope.
   * Scope lives on the job, which is exactly why no new target type is needed.
   *
   * The compensating rollback for a failed enqueue is unit-tested against the
   * injected dependency seam (`curated-products/__tests__/backfill.test.ts`):
   * this suite runs against a real database, where the enqueue does not fail
   * on demand.
   */
  describe('curated product backfill', () => {
    const backfillBrandIds: string[] = []
    const backfillSubmissionIds: string[] = []
    let requester = { id: '', email: '' }

    beforeAll(async () => {
      const client = createTestClient()
      const email = `products-backfill-${randomUUID()}@example.com`
      const { data, error } = await client.auth.admin.createUser({
        email,
        password: `Products-backfill-${randomUUID()}`,
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('Requester creation failed')
      requester = { id: data.user.id, email }
    })

    afterEach(async () => {
      const client = createTestClient()
      if (backfillSubmissionIds.length > 0) {
        await client.from('brand_submissions').delete().in('id', backfillSubmissionIds)
        backfillSubmissionIds.length = 0
      }
      if (backfillBrandIds.length > 0) {
        await client.from('brands').delete().in('id', backfillBrandIds)
        backfillBrandIds.length = 0
      }
    })

    afterAll(async () => {
      if (!requester.id) return
      const client = createTestClient()
      // request_brand_refresh writes a 'refresh_requested' audit row per call,
      // and admin_audit_log.admin_user_id references auth.users.
      await client.from('admin_audit_log').delete().eq('admin_user_id', requester.id)
      await client.auth.admin.deleteUser(requester.id)
    })

    it('backfill_enqueues_a_products_scoped_job', async () => {
      const brandId = await seedBackfillBrand('scoped')

      const result = await requestCuratedProductBackfill([brandId], requester)

      expect(result.outcomes).toEqual([
        { brandId, submissionId: expect.any(String), error: null },
      ])
      backfillSubmissionIds.push(result.outcomes[0]!.submissionId!)
      expect(result.jobId).toBeTruthy()
      createdJobIds.add(result.jobId!)

      const job = await getCurationJob(result.jobId!)
      const params = (job.params ?? {}) as Record<string, unknown>
      // The products phase AND its two hard dependencies, because `runEnrich`
      // expands nothing: `links` supplies the scraped candidate pages and the
      // quarantine records, `site_identity` decides whether the resolved site
      // may be mined at all. `['products']` alone ran the phase against an
      // empty pipeline and the model invented product URLs.
      //
      // `steps` must stay absent: runEnrich resolves steps FIRST and lets them
      // beat phases, so a job carrying both would silently widen to the whole
      // step group.
      expect(params.phases).toEqual(['links', 'site_identity', 'products'])
      expect(params.steps).toBeUndefined()
      expect(params.submissionIds).toEqual([result.outcomes[0]!.submissionId])
      expect(job.dry_run).toBe(false)
    })

    it('backfill_is_sequential_per_brand', async () => {
      const brandId = await seedBackfillBrand('sequential')

      const first = await requestCuratedProductBackfill([brandId], requester)
      backfillSubmissionIds.push(first.outcomes[0]!.submissionId!)
      createdJobIds.add(first.jobId!)

      // The RPC raises 23505 while a refresh is still pending. That is an
      // ordinary answer — "not this one, not yet" — so it must arrive as a
      // message on the outcome and never as a thrown error.
      const second = await requestCuratedProductBackfill([brandId], requester)

      expect(second.jobId).toBeNull()
      expect(second.outcomes).toEqual([
        {
          brandId,
          submissionId: null,
          error: 'A refresh is already pending for this brand',
        },
      ])
    })

    it('backfill_creates_no_new_target_type', async () => {
      const brandId = await seedBackfillBrand('target-type')

      const result = await requestCuratedProductBackfill([brandId], requester)
      backfillSubmissionIds.push(result.outcomes[0]!.submissionId!)
      createdJobIds.add(result.jobId!)

      const client = createTestClient()
      const { data: targets, error } = await client
        .from('curation_job_targets')
        .select('target_type, target_id')
        .eq('job_id', result.jobId!)

      expect(error).toBeNull()
      expect(targets).toEqual([
        { target_type: 'submission', target_id: result.outcomes[0]!.submissionId },
      ])
    })

    /**
     * `request_brand_refresh` requires an approved or hidden brand with a
     * non-null `updated_at`; a missing brand raises P0002.
     */
    async function seedBackfillBrand(suffix: string): Promise<string> {
      const client = createTestClient()
      const id = randomUUID()
      const { error } = await client.from('brands').insert({
        id,
        name: `Backfill ${suffix} Brand`,
        slug: `products-backfill-${suffix}-${id.slice(0, 8)}`,
        status: 'approved',
        description: '原本完整的品牌介紹',
        category: 'home',
        subcategories: ['家具'],
        price_range: 2,
        purchase_website: 'https://backfill.example.com',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      expect(error).toBeNull()
      backfillBrandIds.push(id)
      return id
    }
  })
})

describe.skipIf(!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)(
  'curation queue service-role access',
  () => {
    it('blocks table and queue RPC access for anonymous clients', async () => {
      const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const tableResult = await client.from('curation_jobs').select('id').limit(1)
      const rpcResult = await client.rpc('claim_next_curation_job', {
        p_worker_token: randomUUID(),
      })
      const refreshRequest = await client.rpc('request_brand_refresh', {
        p_brand_id: randomUUID(),
        p_requested_by: randomUUID(),
        p_requester_email: 'anonymous@example.com',
      })
      const refreshApply = await client.rpc('apply_brand_refresh', {
        p_submission_id: randomUUID(),
        p_reviewer_id: randomUUID(),
      })
      const directRefresh = await client.from('brand_submissions').insert({
        brand_id: randomUUID(),
        brand_name: 'Anonymous refresh attack',
        submitter_email: 'anonymous@example.com',
        intent: 'refresh',
        base_brand_data: { name: 'Forged snapshot' },
        base_brand_updated_at: new Date().toISOString(),
      })

      expect(tableResult.error).not.toBeNull()
      expect(rpcResult.error).not.toBeNull()
      expect(refreshRequest.error).not.toBeNull()
      expect(refreshApply.error).not.toBeNull()
      expect(directRefresh.error).not.toBeNull()
    })

    it('blocks direct refresh inserts for authenticated non-admin users', async () => {
      const serviceClient = createTestClient()
      const suffix = randomUUID()
      const email = `refresh-policy-${suffix}@example.com`
      const password = `Refresh-policy-${suffix}`
      const { data: createdUser, error: userError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      expect(userError).toBeNull()
      expect(createdUser.user).not.toBeNull()

      const { data: brand, error: brandError } = await serviceClient
        .from('brands')
        .insert({
          name: 'Refresh policy target',
          slug: `refresh-policy-${suffix}`,
          status: 'approved',
        })
        .select('id, updated_at')
        .single()
      expect(brandError).toBeNull()

      try {
        const authenticatedClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        const { error: signInError } = await authenticatedClient.auth.signInWithPassword({
          email,
          password,
        })
        expect(signInError).toBeNull()

        const { error } = await authenticatedClient.from('brand_submissions').insert({
          brand_id: brand!.id,
          brand_name: 'Forged refresh',
          submitter_email: email,
          intent: 'refresh',
          base_brand_data: { name: 'Forged snapshot' },
          base_brand_updated_at: brand!.updated_at,
          refresh_requested_by: createdUser.user!.id,
        })
        expect(error).not.toBeNull()
      } finally {
        await serviceClient.from('brands').delete().eq('id', brand!.id)
        await serviceClient.auth.admin.deleteUser(createdUser.user!.id)
      }
    })
  }
)

async function enqueue(
  client: ReturnType<typeof createTestClient>,
  overrides: Parameters<typeof enqueueArgs>[0] = {}
): Promise<string> {
  const { data, error } = await client.rpc('enqueue_curation_job', enqueueArgs(overrides))
  if (error || !data) throw error ?? new Error('Enqueue returned no job ID')
  createdJobIds.add(data)
  return data
}

function enqueueArgs(
  overrides: {
    trigger?: 'admin' | 'cron' | 'automatic_retry'
    parentJobId?: string | null
    attempt?: number
    dedupeKey?: string | null
    runAfter?: string
    targets?: Array<Record<string, string | null>>
  } = {}
) {
  const targetId = randomUUID()
  return {
    p_operation: 'enrich',
    p_params: { target: 'submissions' },
    p_dry_run: true,
    p_started_by: 'integration-test',
    p_trigger: overrides.trigger ?? 'admin',
    p_parent_job_id: overrides.parentJobId ?? null,
    p_attempt: overrides.attempt ?? 1,
    p_scheduled_for: null,
    p_run_after: overrides.runAfter ?? '2099-01-01T00:00:00.000Z',
    p_dedupe_key:
      overrides.dedupeKey === undefined ? `integration-job:${randomUUID()}` : overrides.dedupeKey,
    p_targets: overrides.targets ?? [
      {
        target_type: 'submission',
        target_id: targetId,
        brand_name: `整合測試品牌 ${targetId.slice(0, 8)}`,
        brand_slug: null,
      },
    ],
  }
}

async function failJob(
  client: ReturnType<typeof createTestClient>,
  jobId: string,
): Promise<void> {
  const { error } = await client
    .from('curation_jobs')
    .update({
      status: 'failed',
      dispatch_status: 'dispatched',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  expect(error).toBeNull()
}
