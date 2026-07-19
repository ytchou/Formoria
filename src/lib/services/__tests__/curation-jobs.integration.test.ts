import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestClient, describeWithDb } from '@/test/setup'
import { finalizeCurationJob } from '../curation-jobs'

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

    await client.from('curation_jobs').update({ heartbeat_at: '2000-01-01T00:00:00.000Z' }).eq('id', parentId)
    const { data: recovered, error: recoveryError } = await client.rpc('recover_stale_curation_jobs', {
      p_stale_before: '2001-01-01T00:00:00.000Z',
    })
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
    const jobId = await enqueue(client, { runAfter: '2000-01-01T00:00:00.000Z' })
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
    await expect(finalizeCurationJob(jobId, workerToken, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })).resolves.toBe(false)
  })
})

describe.skipIf(!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)('curation queue service-role access', () => {
  it('blocks table and queue RPC access for anonymous clients', async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

    const tableResult = await client.from('curation_jobs').select('id').limit(1)
    const rpcResult = await client.rpc('claim_next_curation_job', {
      p_worker_token: randomUUID(),
    })

    expect(tableResult.error).not.toBeNull()
    expect(rpcResult.error).not.toBeNull()
  })
})

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
    attempt?: 1 | 2
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
    p_dedupe_key: overrides.dedupeKey === undefined ? `integration-job:${randomUUID()}` : overrides.dedupeKey,
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
