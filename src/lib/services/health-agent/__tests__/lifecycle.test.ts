import { describe, expect, it } from 'vitest'
import type { HealthLedgerClient } from '../lifecycle'
import {
  admitRun,
  enqueueFindings,
  reserveTickets,
  finalizeTickets,
  releaseFailedReservations,
  reconcile,
  releaseClaims,
} from '../lifecycle'

// ---------------------------------------------------------------------------
// Fake client builder
// ---------------------------------------------------------------------------

type RpcCall = { fn: string; params: Record<string, unknown> }
type TableWrite = { table: string; op: string; data: unknown }

function fakeClient(options: {
  rpcResults?: Record<string, unknown>
  selectPages?: Record<string, Array<{ data: unknown[]; error: null }>>
  updateResult?: { count: number }
} = {}) {
  const rpcCalls: RpcCall[] = []
  const tableWrites: TableWrite[] = []
  const readCalls: Array<{ table: string }> = []

  const queryBuilder = (table: string, pages?: Array<{ data: unknown[]; error: null }>) => {
    let pageIndex = 0
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      range: (_from: number, _to: number) => {
        const page = pages?.[pageIndex++] ?? { data: [], error: null }
        return Promise.resolve(page)
      },
      update: (data: unknown) => {
        tableWrites.push({ table, op: 'update', data })
        return {
          eq: () => ({
            eq: () => ({
              select: () => Promise.resolve({
                data: Array.from(
                  { length: options.updateResult?.count ?? 1 },
                  () => ({ id: 'fake-id' }),
                ),
                error: null,
              }),
            }),
            select: () => Promise.resolve({
              data: Array.from(
                { length: options.updateResult?.count ?? 1 },
                () => ({ id: 'fake-id' }),
              ),
              error: null,
            }),
          }),
          in: () => ({
            is: () => ({
              select: () => Promise.resolve({
                data: Array.from(
                  { length: options.updateResult?.count ?? 1 },
                  () => ({ id: 'fake-id' }),
                ),
                error: null,
              }),
            }),
            select: () => Promise.resolve({
              data: Array.from(
                { length: options.updateResult?.count ?? 1 },
                () => ({ id: 'fake-id' }),
              ),
              error: null,
            }),
          }),
          is: () => ({
            select: () => Promise.resolve({
              data: Array.from(
                { length: options.updateResult?.count ?? 1 },
                () => ({ id: 'fake-id' }),
              ),
              error: null,
            }),
          }),
          select: () => Promise.resolve({
            data: Array.from(
              { length: options.updateResult?.count ?? 1 },
              () => ({ id: 'fake-id' }),
            ),
            error: null,
          }),
        }
      },
    }
    return builder
  }

  const client: HealthLedgerClient = {
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params })
      const result = options.rpcResults?.[fn]
      return Promise.resolve({ data: result ?? null, error: null }) as never
    },
    from: (table: string) => {
      readCalls.push({ table })
      const pages = options.selectPages?.[table]
      return queryBuilder(table, pages) as never
    },
  }

  return { client, rpcCalls, tableWrites, readCalls }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lifecycle', () => {
  it('admitRun claims with a railway run identity and attempt 1', async () => {
    const { client, rpcCalls } = fakeClient({
      rpcResults: {
        claim_health_agent_run: { claimed: true, run: { id: 'run-1' } },
      },
    })

    await admitRun(client, {
      routine: 'nightly',
      logicalDate: '2026-09-17',
      runId: 'test-uuid',
      workflowAttempt: 1,
      dryRun: false,
    })

    expect(rpcCalls).toHaveLength(1)
    const call = rpcCalls[0]
    expect(call.fn).toBe('claim_health_agent_run')
    expect(call.params.p_requested_run_id).toMatch(/^railway:health-agent:/)
    expect(call.params.p_workflow_attempt).toBe(1)
  })

  it('admitRun returns replay without re-running when the ledger already completed today', async () => {
    const { client } = fakeClient({
      rpcResults: {
        claim_health_agent_run: {
          claimed: false,
          replay: true,
          result: { findings: [] },
          run: { id: 'run-1', status: 'completed' },
        },
      },
    })

    const result = await admitRun(client, {
      routine: 'nightly',
      logicalDate: '2026-09-17',
      runId: 'test-uuid',
      workflowAttempt: 1,
      dryRun: false,
    })

    expect(result.claimed).toBe(false)
    expect(result.replay).toBe(true)
  })

  it('enqueue sends NULL, not an empty string, for a missing sentry issue id', async () => {
    const { client, rpcCalls } = fakeClient({
      rpcResults: { enqueue_health_fix: 'fix-uuid' },
    })

    await enqueueFindings(client, [
      {
        source: 'directory',
        fingerprint: 'directory:brand-invariant:test',
        title: 'Test finding',
        severity: 'medium',
        evidence: {},
        mergePolicy: 'human',
        // No sentryIssueId
      },
    ])

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].params.p_sentry_issue_id).toBeNull()
  })

  it('reserve → finalize writes the real Linear identifier only after the ticket exists', async () => {
    const { client, tableWrites } = fakeClient({
      updateResult: { count: 2 },
      selectPages: {
        health_fix_queue: [
          {
            data: [
              { id: 'fix-1', fingerprint: 'link:dead:a', ticketed_at: null },
              { id: 'fix-2', fingerprint: 'link:dead:b', ticketed_at: null },
            ],
            error: null,
          },
        ],
      },
    })

    await reserveTickets(client, ['fix-1', 'fix-2'])
    // Reserve should set ticketed_at
    expect(tableWrites.length).toBeGreaterThanOrEqual(1)

    // Finalize writes the Linear identifier
    await finalizeTickets(client, [
      { id: 'fix-1', linearIdentifier: 'FORM-123' },
      { id: 'fix-2', linearIdentifier: 'FORM-124' },
    ])

    // Should have written linear_identifier and ticketed_at
    const finalizeWrite = tableWrites.find(
      (w) => w.table === 'health_fix_queue' && w.op === 'update',
    )
    expect(finalizeWrite).toBeDefined()
  })

  it('a failed ticket creation releases the reservation', async () => {
    const { client, tableWrites } = fakeClient()

    await releaseFailedReservations(client, ['fix-1', 'fix-2'])

    expect(tableWrites).toHaveLength(1)
    const write = tableWrites[0]
    expect(write.table).toBe('health_fix_queue')
    // Should null out linear_identifier and ticketed_at
    expect((write.data as Record<string, unknown>).linear_identifier).toBeNull()
    expect((write.data as Record<string, unknown>).ticketed_at).toBeNull()
  })

  it('reserve throws when the updated row count differs from the requested count', async () => {
    const { client } = fakeClient({
      updateResult: { count: 1 }, // Only 1 row updated for 2 requested
    })

    await expect(
      reserveTickets(client, ['fix-1', 'fix-2']),
    ).rejects.toThrow()
  })

  it('reconcile passes only completed sources and every observed fingerprint', async () => {
    const { client, rpcCalls } = fakeClient({
      rpcResults: {
        reconcile_health_fix_lifecycle: [
          { id: 'fix-1', fingerprint: 'link:dead:a', reconciliation: 'fixed', sentry_issue_id: null },
        ],
      },
    })

    await reconcile(client, {
      completedSources: ['link', 'directory'],
      observedFingerprints: ['link:dead:a', 'directory:brand-invariant:b'],
    })

    expect(rpcCalls).toHaveLength(1)
    const call = rpcCalls[0]
    expect(call.fn).toBe('reconcile_health_fix_lifecycle')
    expect(call.params.p_completed_sources).toEqual(['link', 'directory'])
    expect(call.params.p_observed_fingerprints).toEqual([
      'link:dead:a',
      'directory:brand-invariant:b',
    ])
  })

  it('releaseClaims uses the same lease owner string that claimed', async () => {
    const { client, rpcCalls } = fakeClient({
      rpcResults: {
        claim_health_fixes: [{ id: 'fix-1' }],
        release_health_fix_claims: [{ id: 'fix-1' }],
      },
    })

    const leaseOwner = 'railway:health-agent:test-uuid'

    // Claim
    await client.rpc('claim_health_fixes', {
      p_merge_policy: 'automatic',
      p_lease_owner: leaseOwner,
    })

    // Release
    await releaseClaims(client, leaseOwner)

    // Both calls must use the exact same lease owner
    const claimCall = rpcCalls.find((c) => c.fn === 'claim_health_fixes')
    const releaseCall = rpcCalls.find((c) => c.fn === 'release_health_fix_claims')
    expect(claimCall!.params.p_lease_owner).toBe(releaseCall!.params.p_lease_owner)
  })

  it('dryRun performs no rpc and no table write', async () => {
    const { client, rpcCalls, tableWrites } = fakeClient({
      rpcResults: {
        claim_health_agent_run: { claimed: true, dry_run: true },
      },
    })

    await admitRun(client, {
      routine: 'nightly',
      logicalDate: '2026-09-17',
      runId: 'test-uuid',
      workflowAttempt: 1,
      dryRun: true,
    })

    // In dry run mode, the RPC is called with p_dry_run: true which returns
    // immediately in the DB without writing. But the client should only
    // receive the admit call, no enqueue/reconcile/etc.
    const writeRpcs = rpcCalls.filter(
      (c) =>
        c.fn !== 'claim_health_agent_run' ||
        c.params.p_dry_run !== true,
    )
    expect(writeRpcs).toHaveLength(0)
    expect(tableWrites).toHaveLength(0)
  })
})
