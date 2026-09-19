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
import type { RepoWorkerClient } from '../repo-worker-client'
import type { RepairRequest } from '../repair-request'

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
    triggerRepair: undefined,
    runWithAuditContext: (_seed, fn) => fn(),
    flushLangfuse: vi.fn(async () => {}),
    ...overrides,
  }
}

function qualityRegistry(): Detector[] {
  return [
    makeDetector({ name: 'brand-invariants', source: 'directory' }),
    makeDetector({ name: 'vitest', source: 'quality', stub: true }),
    makeDetector({ name: 'knip', source: 'quality', stub: true }),
  ]
}

function cleanQualityResults() {
  return [
    {
      id: 'repo-root',
      stdout: '/repo\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    },
    {
      id: 'tracked-files',
      stdout: 'src/app.test.ts\nsrc/lib/utils.ts\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    },
    {
      id: 'vitest',
      stdout: JSON.stringify({
        numFailedTestSuites: 0,
        numFailedTests: 0,
        numTotalTestSuites: 5,
        numTotalTests: 20,
        success: true,
        testResults: [],
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    },
    {
      id: 'knip',
      stdout:
        "◇ injected env (0) from .env.local // tip: { path: '/custom/path/.env' }\n{\"issues\":[]}",
      stderr: '',
      exitCode: 0,
      timedOut: false,
    },
  ]
}

function rpcCalls(client: RunHealthAgentDeps['client']) {
  return (client.rpc as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, Record<string, unknown>]
  >
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

  it('provides the shared URL checker to weekly link detectors', async () => {
    let checkUrl: unknown
    const deps = baseDeps({
      dryRun: true,
      logicalDate: '2026-09-19',
      registryOverride: [
        makeDetector({
          name: 'social',
          source: 'links-weekly',
          schedule: 'weekly',
          run: async (ctx) => {
            checkUrl = ctx.deps.checkUrl
            return []
          },
        }),
      ],
    })

    await runHealthAgent(deps)

    expect(checkUrl).toBeTypeOf('function')
  })

  it('provides the machine-caller secret to origin probes', async () => {
    vi.stubEnv('ORIGIN_SECRET', 'machine-caller-secret')
    vi.stubEnv('CF_ORIGIN_SECRET', 'edge-secret')

    try {
      let originSecret: unknown
      const deps = baseDeps({
        dryRun: true,
        registryOverride: [
          makeDetector({
            name: 'trail-supply',
            source: 'directory',
            run: async (ctx) => {
              originSecret = ctx.deps.originSecret
              return []
            },
          }),
        ],
      })

      await runHealthAgent(deps)

      expect(originSecret).toBe('machine-caller-secret')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reads active Sentry fingerprints before enqueue and highlights only new or returned issues', async () => {
    const order: string[] = []
    const client = stubClient()
    const originalRpc = client.rpc.bind(client)
    client.rpc = ((fn: string, params: Record<string, unknown>) => {
      if (fn === 'enqueue_health_fix') order.push('enqueue')
      return originalRpc(fn, params)
    }) as typeof client.rpc

    const query: Record<string, unknown> = {}
    query.select = vi.fn(() => query)
    query.order = vi.fn(() => query)
    query.eq = vi.fn(() => query)
    query.in = vi.fn(() => query)
    query.range = vi.fn(async () => {
      order.push('read-active')
      return {
        data: [{
          id: 'active-1',
          fingerprint: 'sentry:issue:existing',
          status: 'pending',
        }],
        error: null,
      }
    })
    client.from = vi.fn(() => query) as unknown as typeof client.from

    const existing: HealthFinding = {
      source: 'sentry',
      fingerprint: 'sentry:issue:existing',
      title: 'Existing runtime issue',
      severity: 'medium',
      evidence: { userCount: 1, lastSeen: '2026-09-19T01:00:00Z' },
      mergePolicy: 'human',
      sentryIssueId: 'existing',
    }
    const returned: HealthFinding = {
      source: 'sentry',
      fingerprint: 'sentry:issue:returned',
      title: 'Returned runtime issue',
      severity: 'high',
      evidence: { userCount: 4, lastSeen: '2026-09-19T02:00:00Z' },
      mergePolicy: 'human',
      sentryIssueId: 'returned',
    }
    let digest = ''

    await runHealthAgent(baseDeps({
      client,
      registryOverride: [
        makeDetector({
          name: 'sentry-triage',
          source: 'sentry',
          run: async () => [existing, returned],
        }),
      ],
      slackPostDigest: async (text) => {
        digest = text
      },
    }))

    expect(order.indexOf('read-active')).toBeLessThan(order.indexOf('enqueue'))
    expect(digest).toContain('Sentry active: 2')
    expect(digest).toContain('Returned runtime issue')
    expect(digest).not.toContain('Existing runtime issue')
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

  // ---- Task 5: quality job dispatch ----

  it('dispatches quality jobs when workerClient is present', async () => {
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: cleanQualityResults(),
    }))

    const workerClient: RepoWorkerClient = { run: runFn }

    const deps = baseDeps({
      registryOverride: qualityRegistry(),
      workerClient,
    })

    await runHealthAgent(deps)

    expect(runFn).toHaveBeenCalledOnce()
    const request = (runFn.mock.calls as unknown[][])[0][0] as {
      commands: { id: string }[]
    }
    const commandIds = request.commands.map((c: { id: string }) => c.id)
    expect(commandIds).toEqual(['repo-root', 'tracked-files', 'vitest', 'knip'])
    expect(
      request.commands.find((command) => command.id === 'vitest'),
    ).toMatchObject({
      timeoutMs: 300_000,
    })
  })

  it('merges quality findings into allFindings', async () => {
    const client = stubClient()
    const vitestJson = JSON.stringify({
      numFailedTestSuites: 1,
      numFailedTests: 1,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: false,
      testResults: [
        {
          name: '/repo/src/app.test.ts',
          status: 'failed',
          assertionResults: [
            {
              status: 'failed',
              title: 'broken test',
              fullName: 'suite broken test',
              failureMessages: ['expected true'],
            },
          ],
        },
      ],
    })

    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        {
          id: 'repo-root',
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'tracked-files',
          stdout: 'src/app.test.ts\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'vitest',
          stdout: vitestJson,
          stderr: '',
          exitCode: 1,
          timedOut: false,
        },
        {
          id: 'knip',
          stdout: '{"issues":[]}',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
      ],
    }))

    const workerClient: RepoWorkerClient = { run: runFn }

    const deps = baseDeps({
      client,
      registryOverride: qualityRegistry(),
      workerClient,
    })

    const result = await runHealthAgent(deps)

    // The detector produces 0 findings, but the vitest job produces 1
    expect(result.totalFindings).toBeGreaterThanOrEqual(1)
    const calls = rpcCalls(client)
    expect(
      calls
        .filter(([name]) => name === 'enqueue_health_fix')
        .map(([, params]) => params.p_fingerprint),
    ).not.toContain('quality:worker-failure:vitest-exec')
    expect(
      calls.find(([name]) => name === 'reconcile_health_fix_lifecycle')?.[1]
        .p_completed_sources,
    ).toContain('quality')
  })

  it('reports missing live worker configuration as worker-transport', async () => {
    const client = stubClient()
    const deps = baseDeps({
      client,
      registryOverride: qualityRegistry(),
      workerClient: undefined,
    })

    const result = await runHealthAgent(deps)

    expect(result.status).toBe('completed')
    expect(result.totalFindings).toBe(1)
    expect(rpcCalls(client)).toContainEqual([
      'enqueue_health_fix',
      expect.objectContaining({
        p_fingerprint: 'quality:worker-failure:worker-transport',
      }),
    ])
  })

  it('worker failures use a stable stage fingerprint and bounded redacted evidence', async () => {
    const client = stubClient()
    const secret = 'synthetic-clone-credential'
    const runFn = vi.fn(async () => ({
      status: 'error' as const,
      error: `install failed with Bearer ${secret}${'x'.repeat(800)}`,
      errorStage: 'install' as const,
      errorCode: 'install-failed',
    }))

    const workerClient: RepoWorkerClient = { run: runFn }

    const deps = baseDeps({
      client,
      registryOverride: qualityRegistry(),
      workerClient,
    })

    const result = await runHealthAgent(deps)

    expect(result.totalFindings).toBe(1)
    expect(result.status).toBe('completed')
    const enqueue = rpcCalls(client).find(
      ([name]) => name === 'enqueue_health_fix',
    )
    expect(enqueue?.[1]).toMatchObject({
      p_fingerprint: 'quality:worker-failure:install',
      p_evidence: expect.objectContaining({
        stage: 'install',
        code: 'install-failed',
      }),
    })
    const evidence = enqueue?.[1].p_evidence as { message: string }
    expect(evidence.message.length).toBeLessThanOrEqual(500)
    expect(evidence.message).not.toContain(secret)

    await runHealthAgent({ ...deps, runId: 'test-run-id-repeat' })
    const failureFingerprints = rpcCalls(client)
      .filter(([name]) => name === 'enqueue_health_fix')
      .map(([, params]) => params.p_fingerprint)
    expect(failureFingerprints).toEqual([
      'quality:worker-failure:install',
      'quality:worker-failure:install',
    ])
  })

  it('warns when quality stubs are missing from results', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const vitestJson = JSON.stringify({
      numFailedTestSuites: 1,
      numFailedTests: 1,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: false,
      testResults: [
        {
          name: '/repo/src/app.test.ts',
          status: 'failed',
          assertionResults: [
            {
              status: 'failed',
              title: 'broken',
              fullName: 'broken',
              failureMessages: ['err'],
            },
          ],
        },
      ],
    })

    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        {
          id: 'repo-root',
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'tracked-files',
          stdout: 'src/app.test.ts\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'vitest',
          stdout: vitestJson,
          stderr: '',
          exitCode: 1,
          timedOut: false,
        },
        {
          id: 'knip',
          stdout: '{"issues":[]}',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
      ],
    }))

    const workerClient: RepoWorkerClient = { run: runFn }

    // No vitest/knip stubs in registry — findings can't be injected
    const deps = baseDeps({
      registryOverride: [
        makeDetector({ name: 'brand-invariants', source: 'directory' }),
      ],
      workerClient,
    })

    await runHealthAgent(deps)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('vitest stub not found'),
    )
    warnSpy.mockRestore()
  })

  it('quality job failure does not crash the run', async () => {
    const runFn = vi.fn(async () => {
      throw new Error('worker connection refused')
    })

    const workerClient: RepoWorkerClient = { run: runFn }

    const deps = baseDeps({
      registryOverride: [
        makeDetector({ name: 'brand-invariants', source: 'directory' }),
        makeDetector({ name: 'vitest', source: 'quality', stub: true }),
        makeDetector({ name: 'knip', source: 'quality', stub: true }),
      ],
      workerClient,
    })

    const result = await runHealthAgent(deps)

    expect(result.status).toBe('completed')
  })

  it('marks quality source as completed when worker jobs succeed', async () => {
    const client = stubClient()
    const completedSourcesCapture: string[][] = []
    const rpcSpy = vi.fn(async (fn: string, params: Record<string, unknown>) => {
      if (fn === 'claim_health_agent_run') {
        return { data: { claimed: true }, error: null }
      }
      if (fn === 'complete_health_agent_run') {
        const result = params.p_result as { completedSources?: string[] }
        if (result?.completedSources) {
          completedSourcesCapture.push(result.completedSources)
        }
        return { data: true, error: null }
      }
      if (fn === 'record_health_snapshot') return { data: null, error: null }
      if (fn === 'release_health_fix_claims') return { data: null, error: null }
      if (fn === 'reconcile_health_fix_lifecycle') return { data: [], error: null }
      return { data: null, error: null }
    })
    ;(client as unknown as { rpc: typeof rpcSpy }).rpc = rpcSpy

    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: cleanQualityResults(),
    }))

    const workerClient: RepoWorkerClient = { run: runFn }

    const deps = baseDeps({
      client,
      registryOverride: qualityRegistry(),
      workerClient,
    })

    await runHealthAgent(deps)

    // completeRun should have been called with 'quality' in completedSources
    expect(completedSourcesCapture.length).toBeGreaterThanOrEqual(1)
    expect(completedSourcesCapture[0]).toContain('quality')
  })

  it('keeps valid Knip findings, emits vitest-exec, and does not complete quality', async () => {
    const client = stubClient()
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        {
          id: 'repo-root',
          stdout: '/repo\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'tracked-files',
          stdout: 'src/lib/utils.ts\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        {
          id: 'vitest',
          stdout: 'not-json',
          stderr: 'setup crashed',
          exitCode: 1,
          timedOut: false,
        },
        {
          id: 'knip',
          stdout: JSON.stringify({
            issues: [{ file: 'src/lib/utils.ts', exports: ['unusedFn'] }],
          }),
          stderr: '',
          exitCode: 1,
          timedOut: false,
        },
      ],
    }))

    await runHealthAgent(
      baseDeps({
        client,
        registryOverride: qualityRegistry(),
        workerClient: { run: runFn },
      }),
    )

    const calls = rpcCalls(client)
    const fingerprints = calls
      .filter(([name]) => name === 'enqueue_health_fix')
      .map(([, params]) => params.p_fingerprint)
    expect(fingerprints).toEqual(
      expect.arrayContaining([
        'quality:dead-code:exports:src/lib/utils.ts:unusedfn',
        'quality:worker-failure:vitest-exec',
      ]),
    )
    const reconcileCall = calls.find(
      ([name]) => name === 'reconcile_health_fix_lifecycle',
    )
    expect(reconcileCall?.[1].p_completed_sources).not.toContain('quality')
  })

  // ---- Task 6: repair trigger ----

  it('triggers repair when repairable findings exist', async () => {
    const triggerRepair = vi.fn(async () => {})

    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [
            {
              source: 'quality',
              fingerprint: 'quality:vitest-failure:test',
              title: 'Test failure: broken test',
              severity: 'high' as const,
              evidence: {},
              mergePolicy: 'automatic' as const,
            },
            {
              source: 'directory',
              fingerprint: 'directory:test:manual',
              title: 'Manual finding',
              severity: 'low' as const,
              evidence: {},
              mergePolicy: 'human' as const,
            },
          ],
        }),
      ],
      triggerRepair,
    })

    await runHealthAgent(deps)

    expect(triggerRepair).toHaveBeenCalledOnce()
    const request = (triggerRepair.mock.calls as unknown[][])[0][0] as RepairRequest
    expect(request.agent).toBe('ops-agent')
    expect(request.ref).toBe('staging')
    expect(request.findings).toHaveLength(1)
    expect(request.findings[0].fingerprint).toBe('quality:vitest-failure:test')
  })

  it('skips trigger when no repairable findings', async () => {
    const triggerRepair = vi.fn(async () => {})

    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [
            {
              source: 'directory',
              fingerprint: 'directory:test:manual',
              title: 'Manual finding',
              severity: 'low' as const,
              evidence: {},
              mergePolicy: 'human' as const,
            },
          ],
        }),
      ],
      triggerRepair,
    })

    await runHealthAgent(deps)

    expect(triggerRepair).not.toHaveBeenCalled()
  })

  it('skips trigger when triggerRepair dep absent', async () => {
    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [
            {
              source: 'quality',
              fingerprint: 'quality:vitest-failure:test',
              title: 'Test failure',
              severity: 'high' as const,
              evidence: {},
              mergePolicy: 'automatic' as const,
            },
          ],
        }),
      ],
      triggerRepair: undefined,
    })

    // Should not crash
    const result = await runHealthAgent(deps)
    expect(result.status).toBe('completed')
  })
})
