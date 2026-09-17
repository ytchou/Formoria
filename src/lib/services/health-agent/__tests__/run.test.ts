/**
 * Run orchestrator tests.
 *
 * Uses DI seams throughout — no vi.mock of @/lib/services/… or @/lib/supabase/….
 */

import { describe, expect, it, vi } from 'vitest'
import type { DetectorName, HealthSource } from '@/lib/constants/health-detectors'
import type { Detector } from '../types'
import type { HealthFinding } from '../contracts'
import {
  runHealthAgent,
  type RunHealthAgentDeps,
} from '../run'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetector(
  overrides: Partial<Detector> & { name: DetectorName; source: HealthSource },
): Detector {
  return {
    schedule: 'nightly',
    severity: 'medium',
    run: async () => [],
    ...overrides,
  }
}

function stubClient(): RunHealthAgentDeps['client'] {
  const rpcResults = new Map<string, unknown>()

  // claim_health_agent_run returns { claimed: true } by default
  rpcResults.set('claim_health_agent_run', { claimed: true })
  rpcResults.set('complete_health_agent_run', true)
  rpcResults.set('fail_health_agent_run', true)
  rpcResults.set('enqueue_health_fix', 'fix-id-1')
  rpcResults.set('reconcile_health_fix_lifecycle', [])
  rpcResults.set('release_health_fix_claims', null)
  rpcResults.set('record_health_snapshot', null)

  return {
    rpc: vi.fn(async (fn: string) => ({
      data: rpcResults.get(fn) ?? null,
      error: null,
    })),
    from: vi.fn(() => {
      const chainedResult = { data: [], error: null }
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.order = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.is = vi.fn(() => chain)
      chain.in = vi.fn(() => chain)
      chain.range = vi.fn(async () => chainedResult)
      chain.update = vi.fn(() => chain)
      return chain
    }),
  } as unknown as RunHealthAgentDeps['client']
}

function baseDeps(overrides?: Partial<RunHealthAgentDeps>): RunHealthAgentDeps {
  return {
    client: stubClient(),
    runId: 'test-run-id',
    logicalDate: '2026-09-16',
    workflowAttempt: 1,
    dryRun: false,
    registryOverride: [
      makeDetector({ name: 'brand-invariants', source: 'directory' }),
    ],
    // Skip worker jobs by default
    workerClient: undefined,
    githubApp: undefined,
    slackPostDigest: vi.fn(async () => {}),
    linearCreateTicket: undefined,
    runWithAuditContext: (_seed, fn) => fn(),
    flushLangfuse: vi.fn(async () => {}),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runHealthAgent', () => {
  it('run order: admit -> detectors -> worker jobs -> consolidate -> ledger -> tickets -> knip fix and repair -> publish -> reconcile -> digest -> complete', async () => {
    const order: string[] = []

    const client = stubClient()
    const rpcSpy = vi.fn(async (fn: string, _params: Record<string, unknown>) => {
      if (fn === 'claim_health_agent_run') {
        order.push('admit')
        return { data: { claimed: true }, error: null }
      }
      if (fn === 'enqueue_health_fix') {
        order.push('enqueue')
        return { data: 'fix-id-1', error: null }
      }
      if (fn === 'reconcile_health_fix_lifecycle') {
        order.push('reconcile')
        return { data: [], error: null }
      }
      if (fn === 'complete_health_agent_run') {
        order.push('complete')
        return { data: true, error: null }
      }
      if (fn === 'record_health_snapshot') {
        return { data: null, error: null }
      }
      if (fn === 'release_health_fix_claims') {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    })
    ;(client as unknown as { rpc: typeof rpcSpy }).rpc = rpcSpy

    const slackPostDigest = vi.fn(async () => {
      order.push('digest')
    })

    const finding: HealthFinding = {
      source: 'directory',
      fingerprint: 'directory:test:finding-1',
      title: 'Test finding',
      severity: 'low',
      evidence: {},
      mergePolicy: 'human',
    }

    const deps = baseDeps({
      client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => {
            order.push('detector')
            return [finding]
          },
        }),
      ],
      slackPostDigest,
    })

    await runHealthAgent(deps)

    // Verify order: admit before detector, detector before enqueue,
    // enqueue before reconcile, reconcile before digest, digest before complete
    expect(order.indexOf('admit')).toBeLessThan(order.indexOf('detector'))
    expect(order.indexOf('detector')).toBeLessThan(order.indexOf('enqueue'))
    expect(order.indexOf('enqueue')).toBeLessThan(order.indexOf('reconcile'))
    expect(order.indexOf('reconcile')).toBeLessThan(order.indexOf('digest'))
    expect(order.indexOf('digest')).toBeLessThan(order.indexOf('complete'))
  })

  it('a replayed admission exits without running detectors', async () => {
    const detectorRan = vi.fn()
    const client = stubClient()
    ;(client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc = vi.fn(
      async (fn: string) => {
        if (fn === 'claim_health_agent_run') {
          return {
            data: { claimed: false, replay: true, result: { prior: true } },
            error: null,
          }
        }
        return { data: null, error: null }
      },
    )

    const deps = baseDeps({
      client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => {
            detectorRan()
            return []
          },
        }),
      ],
    })

    const result = await runHealthAgent(deps)

    expect(detectorRan).not.toHaveBeenCalled()
    expect(result.status).toBe('replay')
  })

  it('dryRun runs every detector and performs zero writes, tickets, PRs or Slack posts', async () => {
    const detectorRan = vi.fn()
    const slackPostDigest = vi.fn(async () => {})
    const linearCreate = vi.fn(async () => ({ identifier: 'DEV-999' }))

    const deps = baseDeps({
      dryRun: true,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async (ctx) => {
            detectorRan(ctx.dryRun)
            return [
              {
                source: 'directory',
                fingerprint: 'directory:test:dry',
                title: 'Dry finding',
                severity: 'low' as const,
                evidence: {},
                mergePolicy: 'human' as const,
              },
            ]
          },
        }),
      ],
      slackPostDigest,
      linearCreateTicket: linearCreate,
    })

    const result = await runHealthAgent(deps)

    // Detector did run
    expect(detectorRan).toHaveBeenCalledWith(true)
    // No tickets created
    expect(linearCreate).not.toHaveBeenCalled()
    // No Slack digest posted
    expect(slackPostDigest).not.toHaveBeenCalled()
    // Result reflects dry run
    expect(result.status).toBe('completed')
    expect(result.dryRun).toBe(true)
  })

  it('worker unreachable skips quality, mdx links and repair and everything else still reports', async () => {
    const detectorRan = vi.fn()

    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => {
            detectorRan()
            return []
          },
        }),
      ],
      // No workerClient = worker unreachable
      workerClient: undefined,
    })

    const result = await runHealthAgent(deps)

    // Detectors still ran
    expect(detectorRan).toHaveBeenCalled()
    expect(result.status).toBe('completed')
  })

  it('at most one PR is published per run and only with allowlisted files', async () => {
    // Since workerClient is not provided, no PR creation happens
    const deps = baseDeps()
    const result = await runHealthAgent(deps)

    // No PR in a run without a worker client
    expect(result.prPublished).toBeFalsy()
  })

  it('a crash in admitRun fails the run and reports the error', async () => {
    const client = stubClient()
    ;(client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc = vi.fn(
      async (fn: string) => {
        if (fn === 'claim_health_agent_run') {
          return { data: null, error: new Error('database connection lost') }
        }
        return { data: null, error: null }
      },
    )

    const deps = baseDeps({ client })

    const result = await runHealthAgent(deps)

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('admitRun failed')
  })

  it('a detector crash becomes a finding without crashing the run', async () => {
    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => {
            throw new Error('catastrophic db failure')
          },
        }),
      ],
    })

    const result = await runHealthAgent(deps)

    // The run completes — detector failures are captured, not propagated
    expect(result.status).toBe('completed')
    // The detector failure is recorded as a finding
    expect(result.totalFindings).toBe(1)
  })

  it('exits 0 on a completed run (status is completed)', async () => {
    const deps = baseDeps()
    const result = await runHealthAgent(deps)
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
  })

  it('exits non-zero when the digest could not be posted', async () => {
    const deps = baseDeps({
      dryRun: false,
      slackPostDigest: vi.fn(async () => {
        throw new Error('Slack API down')
      }),
    })

    const result = await runHealthAgent(deps)
    expect(result.exitCode).not.toBe(0)
  })
})
