/**
 * Plain Node tripwire — verifies that every service function the health-agent
 * host calls executes under plain Node without a Next.js invariant error.
 *
 * Invokes the detector data functions and lifecycle functions with fake
 * clients outside Next.js. A Next invariant error (e.g. from `server-only`
 * or `next/headers`) would throw before the function body runs.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DetectorContext } from '@/lib/services/health-agent/types'
import { registry } from '@/lib/services/health-agent/registry'
import {
  admitRun,
  completeRun,
  failRun,
  enqueueFindings,
  reconcile,
  type HealthLedgerClient,
} from '@/lib/services/health-agent/lifecycle'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeClient(): HealthLedgerClient {
  return {
    rpc: vi.fn(async () => ({ data: { claimed: true }, error: null })),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.order = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.is = vi.fn(() => chain)
      chain.in = vi.fn(() => chain)
      chain.range = vi.fn(async () => ({ data: [], error: null }))
      chain.update = vi.fn(() => chain)
      return chain
    }),
  } as unknown as HealthLedgerClient
}

function fakeDetectorContext(): DetectorContext {
  return {
    date: '2026-09-16',
    deadline: Date.now() + 120_000,
    signal: new AbortController().signal,
    dryRun: true,
    deps: {
      supabase: fakeClient(),
      fetchFn: vi.fn(async () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plain Node tripwire', () => {
  it('every detector in the registry can be invoked without a Next invariant error', async () => {
    const ctx = fakeDetectorContext()

    // We only need to verify no invariant error — the detectors may throw
    // from missing real data, which is fine.
    for (const [name, detector] of Object.entries(registry)) {
      try {
        await detector.run(ctx)
      } catch (err) {
        // A Next.js invariant error contains "NEXT" or "server-only" or
        // "Invariant: " in the message. Those should fail the test.
        const message = err instanceof Error ? err.message : String(err)
        const isNextInvariant =
          message.includes('server-only') ||
          message.includes('Invariant: ') ||
          message.includes('NEXT_')
        expect(
          isNextInvariant,
          `detector "${name}" threw a Next.js invariant error: ${message}`,
        ).toBe(false)
      }
    }
  })

  it('lifecycle functions execute under plain Node without a Next invariant error', async () => {
    const client = fakeClient()

    // admitRun
    await expect(
      admitRun(client, {
        routine: 'nightly',
        logicalDate: '2026-09-16',
        runId: 'test-id',
        workflowAttempt: 1,
        dryRun: false,
      }),
    ).resolves.toBeDefined()

    // completeRun
    ;(client.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: true, error: null })
    await expect(
      completeRun(client, {
        routine: 'nightly',
        logicalDate: '2026-09-16',
        runId: 'test-id',
        workflowAttempt: 1,
        result: { status: 'ok' },
      }),
    ).resolves.toBeDefined()

    // failRun
    await expect(
      failRun(client, {
        routine: 'nightly',
        logicalDate: '2026-09-16',
        runId: 'test-id',
        workflowAttempt: 1,
        errorMessage: 'test error',
      }),
    ).resolves.toBeDefined()

    // enqueueFindings
    ;(client.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: 'fix-id-1',
      error: null,
    })
    await expect(
      enqueueFindings(client, [
        {
          source: 'directory',
          fingerprint: 'directory:test:1',
          title: 'Test',
          severity: 'low',
          evidence: {},
          mergePolicy: 'human',
        },
      ]),
    ).resolves.toBeDefined()

    // reconcile
    ;(client.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [], error: null })
    await expect(
      reconcile(client, {
        completedSources: ['directory'],
        observedFingerprints: ['directory:test:1'],
      }),
    ).resolves.toBeDefined()
  })
})
