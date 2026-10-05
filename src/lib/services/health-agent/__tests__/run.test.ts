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
import { RepairPostRejectedError, type RepairRequest } from '../repair-request'
import { buildRepairTriggerBlocks, buildRepairTriggerMessage } from '../report'
import {
  appendRunEvent,
  startTimeline,
  type TimelineDeps,
} from '@/lib/services/run-timeline/append'
import type { RunEvent, TimelineRef } from '@/lib/services/run-timeline/types'

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

/** The run clock; the ledger fake's default ticketed_at is 6.5 days earlier. */
const RUN_NOW = new Date('2026-09-16T12:00:00Z')

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
    startTimeline: undefined,
    appendRunEvent: undefined,
    slackPostDigest: vi.fn(async () => {}),
    linearCreateTicket: undefined,
    triggerRepair: undefined,
    runWithAuditContext: (_seed, fn) => fn(),
    flushLangfuse: vi.fn(async () => {}),
    now: () => RUN_NOW,
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
      slackPostDigest: async ({ text }) => {
        digest = text
      },
    }))

    expect(order.indexOf('read-active')).toBeLessThan(order.indexOf('enqueue'))
    expect(digest).toContain('Sentry active: 2')
    expect(digest).toContain('Returned runtime issue')
    expect(digest).not.toContain('Existing runtime issue')
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
      timeoutMs: 480_000,
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

  it('keeps the tail of vitest stderr, where the failure is reported (DEV-1931)', async () => {
    const client = stubClient()
    // The head of a real run's stderr is fixed noise (the Vite config warning
    // and expected checker output); the actionable error is printed last.
    const stderr = `${'(!) config warning\n'.repeat(40)}Error: the real cause`
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        { id: 'repo-root', stdout: '/repo\n', stderr: '', exitCode: 0, timedOut: false },
        { id: 'tracked-files', stdout: '', stderr: '', exitCode: 0, timedOut: false },
        { id: 'vitest', stdout: 'not-json', stderr, exitCode: 1, timedOut: false },
        { id: 'knip', stdout: '{"issues":[]}', stderr: '', exitCode: 0, timedOut: false },
      ],
    }))

    await runHealthAgent(
      baseDeps({
        client,
        registryOverride: qualityRegistry(),
        workerClient: { run: runFn },
      }),
    )

    const enqueue = rpcCalls(client).find(
      ([name, params]) =>
        name === 'enqueue_health_fix' &&
        params.p_fingerprint === 'quality:worker-failure:vitest-exec',
    )
    const evidence = enqueue?.[1].p_evidence as { stderr: string }
    expect(evidence.stderr.endsWith('Error: the real cause')).toBe(true)
    expect(evidence.stderr.length).toBeLessThanOrEqual(500)
  })

  it('keeps the Vitest unhandled-errors block, not just its closing text (DEV-1931)', async () => {
    const client = stubClient()
    const testFile = 'src/some/long/path/to/a-test-file.test.ts'
    const frame =
      ' ❯ node_modules/.pnpm/@vitest+runner@4.1.9/node_modules/@vitest/runner/dist/chunk-artifact.js:2326:20\n'
    // Shape copied from a real leaked-rejection run: Vitest's fixed closing
    // text alone fills a 500-char tail, hiding the error and the file.
    const block = [
      '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯',
      '',
      'Vitest caught 1 unhandled error during the test run.',
      'This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.',
      '',
      '⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯',
      'Error: DEV1931_LEAK',
      ` ❯ ${testFile}:3:23`,
      `${frame.repeat(7)}`,
      `This error originated in "${testFile}" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.`,
      'The latest test that might\'ve caused the error is "passes its assertions but leaks a rejection after the test body returns". It might mean one of the following:',
      '- The error was thrown, while Vitest was running this test.',
      '- If the error occurred after the test had been completed, this was the last documented test before it was thrown.',
      '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯',
      '',
    ].join('\n')
    const stderr = `${'(!) config warning\n'.repeat(110)}${block}`
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        { id: 'repo-root', stdout: '/repo\n', stderr: '', exitCode: 0, timedOut: false },
        { id: 'tracked-files', stdout: '', stderr: '', exitCode: 0, timedOut: false },
        { id: 'vitest', stdout: 'not-json', stderr, exitCode: 1, timedOut: false },
        { id: 'knip', stdout: '{"issues":[]}', stderr: '', exitCode: 0, timedOut: false },
      ],
    }))

    await runHealthAgent(
      baseDeps({
        client,
        registryOverride: qualityRegistry(),
        workerClient: { run: runFn },
      }),
    )

    const enqueue = rpcCalls(client).find(
      ([name, params]) =>
        name === 'enqueue_health_fix' &&
        params.p_fingerprint === 'quality:worker-failure:vitest-exec',
    )
    const evidence = enqueue?.[1].p_evidence as { stderr: string }
    expect(evidence.stderr).toContain('Error: DEV1931_LEAK')
    expect(evidence.stderr).toContain('This error originated in')
    expect(evidence.stderr).toContain(testFile)
    expect(evidence.stderr).not.toContain('(!) config warning')
    expect(evidence.stderr.length).toBeLessThanOrEqual(4000)
  })

  it('names a nonzero vitest exit with a clean report (DEV-1931)', async () => {
    const client = stubClient()
    // An unhandled error makes Vitest exit 1 while its JSON report reads clean.
    const vitestJson = JSON.stringify({
      numFailedTestSuites: 0,
      numFailedTests: 0,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: true,
      testResults: [],
    })
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        { id: 'repo-root', stdout: '/repo\n', stderr: '', exitCode: 0, timedOut: false },
        { id: 'tracked-files', stdout: '', stderr: '', exitCode: 0, timedOut: false },
        {
          id: 'vitest',
          stdout: vitestJson,
          stderr: 'Unhandled Rejection',
          exitCode: 1,
          timedOut: false,
        },
        { id: 'knip', stdout: '{"issues":[]}', stderr: '', exitCode: 0, timedOut: false },
      ],
    }))

    await runHealthAgent(
      baseDeps({
        client,
        registryOverride: qualityRegistry(),
        workerClient: { run: runFn },
      }),
    )

    const enqueue = rpcCalls(client).find(
      ([name, params]) =>
        name === 'enqueue_health_fix' &&
        params.p_fingerprint === 'quality:worker-failure:vitest-exec',
    )
    const evidence = enqueue?.[1].p_evidence as { code: string; message: string }
    expect(evidence.code).toBe('nonzero-exit-without-failures')
    expect(evidence.message).toBe('full-unit-suite:nonzero_exit_without_failures')
  })

  it('parses the JSON report when default-reporter lines precede it', async () => {
    const client = stubClient()
    const vitestJson = JSON.stringify({
      numFailedTestSuites: 0,
      numFailedTests: 0,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      success: true,
      testResults: [],
    })
    const runFn = vi.fn(async () => ({
      status: 'done' as const,
      results: [
        { id: 'repo-root', stdout: '/repo\n', stderr: '', exitCode: 0, timedOut: false },
        { id: 'tracked-files', stdout: '', stderr: '', exitCode: 0, timedOut: false },
        {
          id: 'vitest',
          stdout: ` ✓ src/a.test.ts (1 test)\n\n Test Files  1 passed (1)\n${vitestJson}`,
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
        { id: 'knip', stdout: '{"issues":[]}', stderr: '', exitCode: 0, timedOut: false },
      ],
    }))

    await runHealthAgent(
      baseDeps({
        client,
        registryOverride: qualityRegistry(),
        workerClient: { run: runFn },
      }),
    )

    expect(
      rpcCalls(client)
        .filter(([name]) => name === 'enqueue_health_fix')
        .map(([, params]) => params.p_fingerprint),
    ).not.toContain('quality:worker-failure:vitest-exec')
  })

  // ---- Task 6: repair trigger ----

  it('triggers auto-fix only for findings that opt in and are not report_only', async () => {
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
              route: 'auto_fix' as const,
            },
            {
              source: 'directory',
              fingerprint: 'directory:test:manual',
              title: 'Manual finding',
              severity: 'low' as const,
              evidence: {},
              mergePolicy: 'human' as const,
            },
            {
              source: 'quality',
              fingerprint: 'quality:knip:unused-dep',
              title: 'Unused dependency',
              severity: 'low' as const,
              evidence: {},
              mergePolicy: 'human' as const,
              route: 'auto_fix' as const,
              disposition: 'report_only' as const,
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
    // Default route is ticket; report_only forces ticket even when opted in.
    expect(request.findings.map((f) => f.fingerprint)).toEqual([
      'quality:vitest-failure:test',
    ])
  })

  it('skips trigger when no finding routes to auto-fix', async () => {
    const triggerRepair = vi.fn(async () => {})

    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [
            {
              source: 'quality',
              fingerprint: 'quality:knip:unused-dep',
              title: 'Unused dependency',
              severity: 'low' as const,
              evidence: {},
              mergePolicy: 'human' as const,
              disposition: 'report_only' as const,
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

// ---------------------------------------------------------------------------
// Run timeline, per-finding tickets and Block Kit guard
// ---------------------------------------------------------------------------

const HEALTH_CHANNEL = 'C_HEALTH'

type SlackCall = {
  method: 'post' | 'update'
  text: string
  blocks?: unknown[]
}

/** In-memory Slack: stores message metadata so appendRunEvent can read it back. */
function fakeSlack() {
  const metadata = new Map<string, { event_payload: Record<string, unknown> }>()
  const calls: SlackCall[] = []
  let seq = 0

  const deps = {
    postMessage: vi.fn(async (params: {
      text: string
      blocks?: unknown[]
      metadata?: { event_type: string; event_payload: Record<string, unknown> }
    }) => {
      calls.push({ method: 'post', text: params.text, blocks: params.blocks })
      seq += 1
      const ts = `1790000000.${String(seq).padStart(6, '0')}`
      if (params.metadata) metadata.set(ts, params.metadata)
      return { ok: true as const, ts }
    }),
    updateMessage: vi.fn(async (params: {
      ts: string
      text: string
      blocks?: unknown[]
      metadata?: { event_type: string; event_payload: Record<string, unknown> }
    }) => {
      calls.push({ method: 'update', text: params.text, blocks: params.blocks })
      if (params.metadata) metadata.set(params.ts, params.metadata)
      return { ok: true as const }
    }),
    readMessageMetadata: vi.fn(async ({ ts }: { ts: string }) => {
      const stored = metadata.get(ts)
      return {
        ok: true as const,
        metadata: stored
          ? { event_type: 'formoria_run_timeline', event_payload: stored.event_payload }
          : null,
      }
    }),
  } as unknown as TimelineDeps

  function events(ts: string): RunEvent[] {
    return (metadata.get(ts)?.event_payload.events ?? []) as RunEvent[]
  }

  function payload(ts: string): Record<string, unknown> | undefined {
    return metadata.get(ts)?.event_payload
  }

  return { deps, calls, events, payload }
}

/**
 * Ledger fake: distinct queue ids per fingerprint, a configurable set of
 * already-ticketed fingerprints, and recorded reserve/finalize/release writes.
 */
function ticketClient(
  ticketed: Record<string, string> = {},
  options: {
    ledgerReadError?: unknown
    /** Per-fingerprint ticketed_at; defaults to DEFAULT_TICKETED_AT. */
    ticketedAt?: Record<string, string>
    /** Error returned by the finalize write (the Linear identifier update). */
    finalizeError?: unknown
  } = {},
) {
  const client = stubClient()
  const reserved: string[][] = []
  const finalized: Array<{ id: string; linearIdentifier: string }> = []
  const released: string[][] = []
  const restored: Array<{ id: string; ticketedAt: string; linearIdentifier: unknown }> = []
  const selects: string[] = []
  const ticketedAtFor = (fingerprint: string) =>
    options.ticketedAt?.[fingerprint] ?? DEFAULT_TICKETED_AT

  const baseRpc = client.rpc.bind(client)
  client.rpc = vi.fn(async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'enqueue_health_fix') {
      return { data: `id:${String(params.p_fingerprint)}`, error: null }
    }
    return baseRpc(fn, params)
  }) as unknown as typeof client.rpc

  client.from = vi.fn(() => {
    const state: {
      update?: Record<string, unknown>
      ids: string[]
      columns: string
    } = { ids: [], columns: '' }
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn((columns?: string) => {
      if (!state.update) state.columns = columns ?? ''
      return chain
    })
    chain.order = vi.fn(() => chain)
    chain.is = vi.fn(() => chain)
    chain.eq = vi.fn((column: string, value: string) => {
      if (column === 'id') state.ids = [value]
      return chain
    })
    chain.in = vi.fn((_column: string, values: string[]) => {
      state.ids = values
      return chain
    })
    chain.update = vi.fn((values: Record<string, unknown>) => {
      state.update = values
      return chain
    })
    chain.range = vi.fn(async () => {
      selects.push(state.columns)
      if (options.ledgerReadError) {
        return { data: null, error: options.ledgerReadError }
      }
      return {
        data: state.ids.map((id) => {
          const fingerprint = id.slice('id:'.length)
          return {
            id,
            fingerprint,
            status: 'pending',
            // An empty identifier is a ledger row ticketed with no linear_identifier.
            ticketed_at: fingerprint in ticketed ? ticketedAtFor(fingerprint) : null,
            linear_identifier: ticketed[fingerprint] || null,
          }
        }),
        error: null,
      }
    })
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      const update = state.update
      const restoring =
        update !== undefined &&
        'linear_identifier' in update &&
        state.ids.length === 1 &&
        update.ticketed_at === ticketedAtFor(state.ids[0].slice('id:'.length))
      if (restoring) {
        restored.push({
          id: state.ids[0],
          ticketedAt: update.ticketed_at as string,
          linearIdentifier: update.linear_identifier,
        })
      } else if (update && update.linear_identifier === null) {
        released.push(state.ids)
      } else if (update && typeof update.linear_identifier === 'string') {
        if (options.finalizeError) {
          return Promise.resolve({ data: null, error: options.finalizeError })
            .then(resolve, reject)
        }
        for (const id of state.ids) {
          finalized.push({ id, linearIdentifier: update.linear_identifier })
        }
      } else if (update) {
        reserved.push(state.ids)
      }
      return Promise.resolve({
        data: state.ids.map((id) => ({ id })),
        error: null,
      }).then(resolve, reject)
    }
    return chain
  }) as unknown as typeof client.from

  return { client, reserved, finalized, released, restored, selects }
}

/** Within the follow-up window of RUN_NOW, so an existing ticket is not re-filed. */
const DEFAULT_TICKETED_AT = '2026-09-10T00:00:00Z'

function finding(
  fingerprint: string,
  overrides: Partial<HealthFinding> = {},
): HealthFinding {
  return {
    source: 'directory',
    fingerprint,
    title: `Finding ${fingerprint}`,
    severity: 'medium',
    evidence: {},
    mergePolicy: 'human',
    ...overrides,
  }
}

const REPORT_ONLY = finding('directory:test:report-only', {
  disposition: 'report_only',
  title: 'Report-only finding',
})
const REPAIRABLE = finding('quality:vitest-failure:repairable', {
  source: 'quality',
  title: 'Repairable finding',
  mergePolicy: 'automatic',
  route: 'auto_fix',
})

function timelineDeps(
  slack: ReturnType<typeof fakeSlack>,
  findings: HealthFinding[],
  overrides: Partial<RunHealthAgentDeps> = {},
): RunHealthAgentDeps {
  return baseDeps({
    registryOverride: [
      makeDetector({
        name: 'brand-invariants',
        source: 'directory',
        run: async () => findings,
      }),
    ],
    startTimeline: vi.fn((date: string, id: string) =>
      startTimeline(
        {
          channel: HEALTH_CHANNEL,
          agent: 'health-agent',
          title: `Health Agent — ${date}`,
          runId: id,
        },
        slack.deps,
      ),
    ),
    appendRunEvent: vi.fn((ref: TimelineRef, event: RunEvent) =>
      appendRunEvent(ref, event, slack.deps),
    ),
    slackPostDigest: vi.fn(async (
      { text, blocks }: { text: string; blocks: Array<Record<string, unknown>> },
      threadTs?: string,
    ) => {
      await slack.deps.postMessage({
        channel: HEALTH_CHANNEL,
        text,
        blocks,
        threadTs,
      })
    }),
    ...overrides,
  })
}

function repairTrigger(slack: ReturnType<typeof fakeSlack>) {
  return vi.fn(async (request: RepairRequest, threadTs?: string) => {
    await slack.deps.postMessage({
      channel: HEALTH_CHANNEL,
      text: buildRepairTriggerMessage('U_OPS', request, 'Health agent', 'Auto-fix Request'),
      blocks: buildRepairTriggerBlocks(request, 'Health Agent', 'Auto-fix Request'),
      threadTs,
    })
  })
}

/** The timeline parent is the first message the fake Slack posts. */
const PARENT_TS = '1790000000.000001'

describe('runHealthAgent — run timeline', () => {
  it('starts the timeline with the date and run id, then appends findings and completed when nothing is repairable', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [REPORT_ONLY], {
      triggerRepair: repairTrigger(slack),
    })

    await runHealthAgent(deps)

    expect(deps.startTimeline).toHaveBeenCalledWith('2026-09-16', 'test-run-id')
    const events = slack.events(PARENT_TS)
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'completed',
    ])
    expect(events[1]).toMatchObject({
      kind: 'findings',
      total: 1,
      autoFix: 0,
      ticket: 1,
    })
    expect(events[1]).not.toHaveProperty('acknowledged')
    expect(events[1]).not.toHaveProperty('acknowledgedGroups')
    expect(events[1]).not.toHaveProperty('failedDetectorNames')
    expect(deps.triggerRepair).not.toHaveBeenCalled()
  })

  it('findings event names failed detectors', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [], {
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [],
        }),
        makeDetector({
          name: 'link-health',
          source: 'link',
          run: async () => {
            throw new Error('link checker down')
          },
        }),
      ],
    })

    await runHealthAgent(deps)

    expect(slack.events(PARENT_TS)[1]).toMatchObject({
      kind: 'findings',
      failedDetectors: 1,
      failedDetectorNames: ['link-health'],
    })
  })

  it('appends repair_requested before triggering repair and passes the timeline on the request', async () => {
    const slack = fakeSlack()
    let kindsAtTrigger: string[] = []
    const post = repairTrigger(slack)
    const triggerRepair = vi.fn(async (request: RepairRequest, threadTs?: string) => {
      kindsAtTrigger = slack.events(PARENT_TS).map((event) => event.kind)
      await post(request, threadTs)
    })
    const deps = timelineDeps(slack, [REPORT_ONLY, REPAIRABLE], { triggerRepair })

    await runHealthAgent(deps)

    expect(kindsAtTrigger).toEqual(['started', 'findings', 'repair_requested'])
    expect(slack.events(PARENT_TS).map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'repair_requested',
    ])
    expect(slack.events(PARENT_TS)[1]).toMatchObject({
      total: 2,
      autoFix: 1,
      ticket: 1,
    })
    const [request, threadTs] = triggerRepair.mock.calls[0]
    expect(request.timeline).toEqual({ channel: HEALTH_CHANNEL, ts: PARENT_TS })
    expect(threadTs).toBe(PARENT_TS)
  })

  it('ends on repair_failed when the repair trigger times out', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [REPAIRABLE], {
      triggerRepair: vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout')
      }),
    })

    await runHealthAgent(deps)

    const events = slack.events(PARENT_TS)
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'repair_requested',
      'repair_failed',
    ])
    expect(events[3]).toMatchObject({
      reason: 'The operation was aborted due to timeout',
    })
  })

  it('makes no appends when the timeline could not be started', async () => {
    const appendSpy = vi.fn(async () => true)
    const triggerRepair = vi.fn(async () => {})
    const deps = baseDeps({
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPAIRABLE],
        }),
      ],
      startTimeline: vi.fn(async () => null),
      appendRunEvent: appendSpy,
      triggerRepair,
    })

    await runHealthAgent(deps)

    expect(appendSpy).not.toHaveBeenCalled()
    const request = (triggerRepair.mock.calls as unknown[][])[0][0] as RepairRequest
    expect(request.timeline).toBeUndefined()
  })

  it('does not start a timeline in dry-run mode', async () => {
    const startSpy = vi.fn(async () => ({ channel: HEALTH_CHANNEL, ts: '1.1' }))
    await runHealthAgent(baseDeps({ dryRun: true, startTimeline: startSpy }))
    expect(startSpy).not.toHaveBeenCalled()
  })
})

describe('runHealthAgent — per-finding tickets', () => {
  it('files one ticket per new report-only finding and none for repairable findings when repair is triggered', async () => {
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async (spec: { title: string }) => ({
      identifier: spec.title.includes('Second') ? 'DEV-2' : 'DEV-1',
    }))
    const second = finding('directory:test:report-only-2', {
      disposition: 'report_only',
      title: 'Second report-only finding',
    })

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY, second, REPAIRABLE],
        }),
      ],
      linearCreateTicket,
      triggerRepair: vi.fn(async () => {}),
    }))

    expect(linearCreateTicket).toHaveBeenCalledTimes(2)
    const titles = linearCreateTicket.mock.calls.map(([spec]) => spec.title)
    expect(titles.some((title) => title.includes('Report-only finding'))).toBe(true)
    expect(titles.some((title) => title.includes('Second report-only finding'))).toBe(true)
    expect(titles.some((title) => title.includes('Repairable finding'))).toBe(false)
    expect(ledger.reserved).toEqual([
      [`id:${REPORT_ONLY.fingerprint}`],
      [`id:${second.fingerprint}`],
    ])
    expect(ledger.finalized).toEqual([
      { id: `id:${REPORT_ONLY.fingerprint}`, linearIdentifier: 'DEV-1' },
      { id: `id:${second.fingerprint}`, linearIdentifier: 'DEV-2' },
    ])
  })

  it('skips report-only findings that already have a ticket', async () => {
    const ledger = ticketClient({ [REPORT_ONLY.fingerprint]: 'DEV-10' })
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-11' }))

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY],
        }),
      ],
      linearCreateTicket,
    }))

    expect(linearCreateTicket).not.toHaveBeenCalled()
  })

  it('files fallback tickets for new repairable findings when triggerRepair is absent, but never for Sentry', async () => {
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-20' }))
    const sentry = finding('sentry:issue:abc', {
      source: 'sentry',
      title: 'Sentry issue',
      route: 'auto_fix',
    })

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY, REPAIRABLE, sentry],
        }),
      ],
      linearCreateTicket,
      triggerRepair: undefined,
    }))

    const titles = linearCreateTicket.mock.calls.map(
      (call) => (call as unknown as [{ title: string }])[0].title,
    )
    expect(titles).toHaveLength(2)
    expect(titles.some((title) => title.includes('Report-only finding'))).toBe(true)
    expect(titles.some((title) => title.includes('Repairable finding'))).toBe(true)
    expect(titles.some((title) => title.includes('Sentry issue'))).toBe(false)
  })

  it('files fallback tickets for new repairable findings when Slack rejects the repair post', async () => {
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-2041' }))

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPAIRABLE],
        }),
      ],
      linearCreateTicket,
      triggerRepair: vi.fn(async () => {
        throw new RepairPostRejectedError('msg_too_long')
      }),
    }))

    expect(linearCreateTicket).toHaveBeenCalledOnce()
    const [spec] = linearCreateTicket.mock.calls[0] as unknown as [{ title: string }]
    expect(spec.title).toContain('Repairable finding')
    expect(ledger.finalized).toEqual([
      { id: `id:${REPAIRABLE.fingerprint}`, linearIdentifier: 'DEV-2041' },
    ])
  })

  it('files no fallback ticket when the repair post may have been delivered', async () => {
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-2042' }))

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPAIRABLE],
        }),
      ],
      linearCreateTicket,
      triggerRepair: vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout')
      }),
    }))

    // The routine may already own these findings; tomorrow's run re-sends
    // them because ticketed_at stays NULL.
    expect(linearCreateTicket).not.toHaveBeenCalled()
    expect(ledger.reserved).toEqual([])
  })

  it('files no ticket and sends repair findings without ticketId when the ledger read returns an error', async () => {
    const ledger = ticketClient(
      { [REPAIRABLE.fingerprint]: 'DEV-2043' },
      { ledgerReadError: { code: '57014', message: 'canceling statement due to statement timeout' } },
    )
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-2044' }))
    const triggerRepair = vi.fn(async () => {})

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY, REPAIRABLE],
        }),
      ],
      linearCreateTicket,
      triggerRepair,
    }))

    expect(linearCreateTicket).not.toHaveBeenCalled()
    expect(ledger.reserved).toEqual([])
    const request = (triggerRepair.mock.calls as unknown[][])[0][0] as RepairRequest
    expect(request.findings).toHaveLength(1)
    expect(request.findings[0].ticketId).toBeUndefined()
  })

  it('releases the reservation when ticket creation fails', async () => {
    const ledger = ticketClient()

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY],
        }),
      ],
      linearCreateTicket: vi.fn(async () => {
        throw new Error('linear down')
      }),
    }))

    expect(ledger.released).toEqual([[`id:${REPORT_ONLY.fingerprint}`]])
    expect(ledger.finalized).toEqual([])
  })

  it('keeps the reservation and logs the identifier when finalize fails after creation', async () => {
    const ledger = ticketClient({}, { finalizeError: new Error('db down') })
    const linearCreateTicket = vi.fn(async () => ({
      identifier: 'DEV-77',
      url: 'https://linear.app/x/issue/DEV-77',
    }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runHealthAgent(baseDeps({
        client: ledger.client,
        registryOverride: [
          makeDetector({
            name: 'brand-invariants',
            source: 'directory',
            run: async () => [REPORT_ONLY, REPORT_ONLY],
          }),
        ],
        linearCreateTicket,
      }))

      expect(linearCreateTicket).toHaveBeenCalledOnce()
      expect(ledger.reserved).toEqual([[`id:${REPORT_ONLY.fingerprint}`]])
      expect(ledger.released).toEqual([])
      expect(ledger.restored).toEqual([])
      const logged = errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
      expect(logged).toContain('DEV-77')
      expect(logged).toContain(`id:${REPORT_ONLY.fingerprint}`)
      expect(logged).toContain(REPORT_ONLY.fingerprint)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('sets ticketId on repair findings from the ledger linear_identifier', async () => {
    const other = finding('directory:test:repairable-2', {
      title: 'Other repairable',
      route: 'auto_fix',
    })
    const ledger = ticketClient({ [REPAIRABLE.fingerprint]: 'DEV-40' })
    const triggerRepair = vi.fn(async () => {})

    await runHealthAgent(baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPAIRABLE, other],
        }),
      ],
      triggerRepair,
    }))

    expect(ledger.selects).toContainEqual(expect.stringContaining('linear_identifier'))
    const request = (triggerRepair.mock.calls as unknown[][])[0][0] as RepairRequest
    const byFingerprint = new Map(request.findings.map((f) => [f.fingerprint, f]))
    expect(byFingerprint.get(REPAIRABLE.fingerprint)?.ticketId).toBe('DEV-40')
    expect(byFingerprint.get(other.fingerprint)?.ticketId).toBeUndefined()
  })
})

describe('runHealthAgent — Block Kit guard', () => {
  it('every Slack post and update made during a run passes a non-empty blocks array', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [REPORT_ONLY, REPAIRABLE], {
      triggerRepair: repairTrigger(slack),
    })

    await runHealthAgent(deps)

    // start, findings update, digest, repair_requested update, repair trigger
    expect(slack.calls.length).toBeGreaterThanOrEqual(5)
    for (const call of slack.calls) {
      expect(Array.isArray(call.blocks), `${call.method}: ${call.text}`).toBe(true)
      expect(call.blocks?.length, `${call.method}: ${call.text}`).toBeGreaterThan(0)
    }
  })

  it('the repair trigger keeps its json fence in the message text', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [REPAIRABLE], {
      triggerRepair: repairTrigger(slack),
    })

    await runHealthAgent(deps)

    const trigger = slack.calls.find((call) => call.text.includes('auto-fix request'))
    expect(trigger?.text).toMatch(/```json\n\{.*\}\n```/)
    const fenced = /```json\n([\s\S]*?)\n```/.exec(trigger?.text ?? '')
    const parsed = JSON.parse(fenced?.[1] ?? '{}') as RepairRequest
    expect(parsed.timeline).toEqual({ channel: HEALTH_CHANNEL, ts: PARENT_TS })
  })
})

describe('runHealthAgent — ticket_outcomes timeline event', () => {
  const urlFor = (identifier: string) =>
    `https://linear.app/formoria/issue/${identifier}/slug`

  const outcomeEvents = (slack: ReturnType<typeof fakeSlack>) =>
    slack
      .events(PARENT_TS)
      .filter((event): event is Extract<RunEvent, { kind: 'ticket_outcomes' }> =>
        event.kind === 'ticket_outcomes')

  function ticketingDeps(
    findings: HealthFinding[],
    overrides: Partial<RunHealthAgentDeps> = {},
  ) {
    const slack = fakeSlack()
    const ledger = ticketClient()
    let next = 0
    const linearCreateTicket = vi.fn(async () => {
      next += 1
      const identifier = `DEV-${next}`
      return { identifier, url: urlFor(identifier) }
    })
    const deps = timelineDeps(slack, findings, {
      client: ledger.client,
      linearCreateTicket,
      ...overrides,
    })
    return { slack, deps }
  }

  it('lists report-only tickets before completed', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY], {
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    const events = slack.events(PARENT_TS)
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'ticket_outcomes',
      'completed',
    ])
    expect(events[2]).toEqual({
      kind: 'ticket_outcomes',
      at: expect.any(Number),
      bucket: 'ticket',
      items: [
        {
          title: 'Report-only finding',
          outcome: 'filed',
          ticketId: 'DEV-1',
          url: urlFor('DEV-1'),
        },
      ],
    })
  })

  it('ticket_outcomes reports filed and follow_up items with url', async () => {
    const stale = finding('directory:test:stale', {
      disposition: 'report_only',
      title: 'Stale finding',
    })
    const { slack, deps } = ticketingDeps([REPORT_ONLY, stale], {
      triggerRepair: vi.fn(async () => {}),
      client: ticketClient(
        { [stale.fingerprint]: 'DEV-10' },
        { ticketedAt: { [stale.fingerprint]: '2026-08-31T00:00:00Z' } },
      ).client,
    })

    await runHealthAgent(deps)

    const outcomes = outcomeEvents(slack)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].items).toEqual([
      {
        title: 'Report-only finding',
        outcome: 'filed',
        ticketId: 'DEV-1',
        url: urlFor('DEV-1'),
      },
      {
        title: 'Stale finding',
        outcome: 'follow_up',
        ticketId: 'DEV-2',
        url: urlFor('DEV-2'),
      },
    ])
  })

  it('ticket_outcomes reports an existing ticket with Linear state and followUpOn', async () => {
    const ledger = ticketClient(
      { [REPORT_ONLY.fingerprint]: 'DEV-1909' },
      { ticketedAt: { [REPORT_ONLY.fingerprint]: '2026-09-29T20:58:00Z' } },
    )
    const linearGetTicketStates = vi.fn(async () =>
      new Map([['DEV-1909', { state: 'Duplicate', closed: true }]]))
    const { slack, deps } = ticketingDeps([REPORT_ONLY], {
      client: ledger.client,
      logicalDate: '2026-10-01',
      now: () => new Date('2026-10-01T12:00:00Z'),
      triggerRepair: vi.fn(async () => {}),
      linearGetTicketStates,
    })

    await runHealthAgent(deps)

    expect(deps.linearCreateTicket).not.toHaveBeenCalled()
    expect(linearGetTicketStates).toHaveBeenCalledOnce()
    expect(linearGetTicketStates).toHaveBeenCalledWith(['DEV-1909'])
    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.bucket).toBe('ticket')
    expect(outcomes.items).toEqual([
      {
        title: 'Report-only finding',
        outcome: 'existing',
        ticketId: 'DEV-1909',
        ticketedAt: '2026-09-29T20:58:00Z',
        state: 'Duplicate',
        closed: true,
        followUpOn: '2026-10-13',
      },
    ])
  })

  it('state read failure leaves state undefined and the run completes', async () => {
    const ledger = ticketClient({ [REPORT_ONLY.fingerprint]: 'DEV-1909' })
    const linearGetTicketStates = vi.fn(async () => {
      throw new Error('linear graphql 500')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { slack, deps } = ticketingDeps([REPORT_ONLY], {
        client: ledger.client,
        triggerRepair: vi.fn(async () => {}),
        linearGetTicketStates,
      })

      const result = await runHealthAgent(deps)

      expect(result.status).toBe('completed')
      expect(linearGetTicketStates).toHaveBeenCalledOnce()
      const [outcomes] = outcomeEvents(slack)
      expect(outcomes.items).toHaveLength(1)
      expect(outcomes.items[0]).toMatchObject({ outcome: 'existing', ticketId: 'DEV-1909' })
      expect(outcomes.items[0]).not.toHaveProperty('state')
      expect(outcomes.items[0]).not.toHaveProperty('closed')
      expect(slack.events(PARENT_TS).at(-1)?.kind).toBe('completed')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reports sentry findings and ledger rows with no identifier as not_eligible', async () => {
    const unlinked = finding('directory:test:unlinked', {
      disposition: 'report_only',
      title: 'Unlinked finding',
    })
    const sentry = finding('sentry:issue:abc', {
      source: 'sentry',
      title: 'Sentry issue',
    })
    const { slack, deps } = ticketingDeps([unlinked, sentry], {
      client: ticketClient({ [unlinked.fingerprint]: '' }).client,
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    expect(deps.linearCreateTicket).not.toHaveBeenCalled()
    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.items.map((item) => [item.title, item.outcome])).toEqual([
      ['Unlinked finding', 'not_eligible'],
      ['Sentry issue', 'not_eligible'],
    ])
    for (const item of outcomes.items) expect(item.reason).toEqual(expect.any(String))
  })

  it('ledger read failure emits not_processed items', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY], {
      client: ticketClient({}, {
        ledgerReadError: { code: '57014', message: 'statement timeout' },
      }).client,
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    expect(deps.linearCreateTicket).not.toHaveBeenCalled()
    expect(slack.events(PARENT_TS).map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'ticket_outcomes',
      'completed',
    ])
    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.items).toEqual([
      expect.objectContaining({
        title: 'Report-only finding',
        outcome: 'not_processed',
        reason: 'ticket ledger read failed',
      }),
    ])
  })

  it('enqueue failure emits not_processed items naming the enqueue, not the ledger', async () => {
    const ledger = ticketClient()
    const rpc = ledger.client.rpc
    ledger.client.rpc = vi.fn(async (fn: string, params: Record<string, unknown>) =>
      fn === 'enqueue_health_fix'
        ? { data: null, error: { message: 'enqueue rpc down' } }
        : rpc(fn, params)) as unknown as typeof rpc
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { slack, deps } = ticketingDeps([REPORT_ONLY], {
        client: ledger.client,
        triggerRepair: vi.fn(async () => {}),
      })

      await runHealthAgent(deps)

      expect(deps.linearCreateTicket).not.toHaveBeenCalled()
      const [outcomes] = outcomeEvents(slack)
      expect(outcomes.items).toEqual([
        {
          title: 'Report-only finding',
          outcome: 'not_processed',
          reason: 'finding was not enqueued',
        },
      ])
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('truncates each stored item title to 120 characters', async () => {
    const longTitle = `Brand ${'x'.repeat(300)} has no logo`
    const { slack, deps } = ticketingDeps(
      [finding('directory:test:long', { disposition: 'report_only', title: longTitle })],
      { triggerRepair: vi.fn(async () => {}) },
    )

    await runHealthAgent(deps)

    const [outcomes] = outcomeEvents(slack)
    const title = outcomes.items[0].title
    expect(Array.from(title)).toHaveLength(120)
    expect(longTitle.startsWith(title.slice(0, -1))).toBe(true)
    expect(title.endsWith('…')).toBe(true)
    // The Linear ticket keeps the full title; only the timeline item is bounded.
    expect(deps.linearCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('x'.repeat(300)) }),
    )
  })

  it('does not emit tickets_filed from the health agent anymore', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY, REPAIRABLE], {
      triggerRepair: undefined,
    })

    await runHealthAgent(deps)

    expect(deps.linearCreateTicket).toHaveBeenCalledTimes(2)
    expect(slack.events(PARENT_TS).some((event) => event.kind === 'tickets_filed'))
      .toBe(false)
  })

  it('appends report-only tickets before repair_requested', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY, REPAIRABLE], {
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    expect(slack.events(PARENT_TS).map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'ticket_outcomes',
      'repair_requested',
    ])
  })

  it('appends fallback tickets before completed when triggerRepair is absent', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY, REPAIRABLE], {
      triggerRepair: undefined,
    })

    await runHealthAgent(deps)

    const events = slack.events(PARENT_TS)
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'ticket_outcomes',
      'ticket_outcomes',
      'completed',
    ])
    expect(events[2]).toMatchObject({ kind: 'ticket_outcomes', bucket: 'ticket' })
    expect(events[3]).toMatchObject({
      kind: 'ticket_outcomes',
      bucket: 'auto_fix',
      items: [
        {
          title: 'Repairable finding',
          outcome: 'filed',
          ticketId: 'DEV-2',
          url: urlFor('DEV-2'),
        },
      ],
    })
  })

  it('fallback filing after a rejected trigger emits ticket_outcomes with bucket auto_fix', async () => {
    const { slack, deps } = ticketingDeps([REPAIRABLE], {
      triggerRepair: vi.fn(async () => {
        throw new RepairPostRejectedError('not_in_channel')
      }),
    })

    await runHealthAgent(deps)

    const events = slack.events(PARENT_TS)
    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'repair_requested',
      'ticket_outcomes',
      'repair_failed',
    ])
    expect(events[3]).toMatchObject({
      kind: 'ticket_outcomes',
      bucket: 'auto_fix',
      items: [{ title: 'Repairable finding', outcome: 'filed', ticketId: 'DEV-1' }],
    })
    expect(events[4]).toMatchObject({
      reason: 'repair trigger post rejected by Slack: not_in_channel',
    })
  })

  it('ends on repair_failed with no fallback tickets when the repair post may have been delivered', async () => {
    const { slack, deps } = ticketingDeps([REPAIRABLE], {
      triggerRepair: vi.fn(async () => {
        throw new Error('fetch failed')
      }),
    })

    await runHealthAgent(deps)

    expect(slack.events(PARENT_TS).map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'repair_requested',
      'repair_failed',
    ])
  })

  it('lists at most 50 tickets in one event while filing every one in Linear', async () => {
    const findings = Array.from({ length: 51 }, (_, i) =>
      finding(`directory:brand-missing-logo:${(0x1a2b3c + i).toString(16)}`, {
        disposition: 'report_only',
        title: `Brand ${i + 1} has no logo`,
      }),
    )
    const { slack, deps } = ticketingDeps(findings, {
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    expect(deps.linearCreateTicket).toHaveBeenCalledTimes(51)
    const outcomes = outcomeEvents(slack)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].items).toHaveLength(50)
    expect(outcomes[0].items[0].ticketId).toBe('DEV-1')
  })

  it('metadata for 50 typical ticket_outcomes items serializes under 8 KB', async () => {
    const findings = Array.from({ length: 50 }, (_, i) =>
      finding(`directory:brand-missing-logo:${(0x1a2b3c + i).toString(16)}`, {
        disposition: 'report_only',
        title: `Brand ${i + 1} has no logo`,
      }),
    )
    const { slack, deps } = ticketingDeps(findings, {
      triggerRepair: vi.fn(async () => {}),
    })

    await runHealthAgent(deps)

    expect(outcomeEvents(slack)[0].items).toHaveLength(50)
    const bytes = Buffer.byteLength(JSON.stringify(slack.payload(PARENT_TS)), 'utf8')
    expect(bytes).toBeLessThan(8192)
  })

  // Worst case: 50 items with titles at the 120-character storage limit and
  // full Linear URLs (60-character title slug). Measured ~14.5 KB, so the
  // 50-item cap with title truncation bounds the event under 16 KB, not 8 KB.
  it('metadata for 50 worst-case ticket_outcomes items stays bounded', async () => {
    const findings = Array.from({ length: 50 }, (_, i) =>
      finding(`directory:brand-missing-logo:${(0x1a2b3c + i).toString(16)}`, {
        disposition: 'report_only',
        title: `${i} ${'x'.repeat(300)}`,
      }),
    )
    let next = 1000
    const { slack, deps } = ticketingDeps(findings, {
      triggerRepair: vi.fn(async () => {}),
      linearCreateTicket: vi.fn(async () => {
        next += 1
        const identifier = `DEV-${next}`
        return {
          identifier,
          url: `https://linear.app/formoria/issue/${identifier}/${'s'.repeat(60)}`,
        }
      }),
    })

    await runHealthAgent(deps)

    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.items).toHaveLength(50)
    for (const item of outcomes.items) expect(Array.from(item.title)).toHaveLength(120)
    const bytes = Buffer.byteLength(JSON.stringify(slack.payload(PARENT_TS)), 'utf8')
    expect(bytes).toBeLessThan(16384)
  })

  it('lists a ticket without a url by its identifier only', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY], {
      triggerRepair: vi.fn(async () => {}),
      linearCreateTicket: vi.fn(async () => ({ identifier: 'DEV-50' })),
    })

    await runHealthAgent(deps)

    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.items).toEqual([
      { title: 'Report-only finding', outcome: 'filed', ticketId: 'DEV-50' },
    ])
  })

  it('reports a failed item when ticket creation throws', async () => {
    const { slack, deps } = ticketingDeps([REPORT_ONLY], {
      triggerRepair: vi.fn(async () => {}),
      linearCreateTicket: vi.fn(async () => {
        throw new Error('linear down')
      }),
    })

    await runHealthAgent(deps)

    expect(slack.events(PARENT_TS).map((event) => event.kind)).toEqual([
      'started',
      'findings',
      'ticket_outcomes',
      'completed',
    ])
    const [outcomes] = outcomeEvents(slack)
    expect(outcomes.items).toEqual([
      expect.objectContaining({
        title: 'Report-only finding',
        outcome: 'failed',
        reason: expect.stringContaining('linear down'),
      }),
    ])
    expect(outcomes.items[0]).not.toHaveProperty('ticketId')
  })
})

describe('runHealthAgent — acknowledged known debt', () => {
  // Injected, so these cases do not depend on the shipped acknowledgement list.
  const ACKNOWLEDGEMENTS: RunHealthAgentDeps['acknowledgements'] = [
    {
      match: 'directory:trail-empty-section:',
      reason: 'Test acknowledgement',
      ticket: 'DEV-1903',
      until: '2026-12-31',
    },
  ]
  const ACK_TICKET = finding('directory:trail-empty-section:autumn-kitchen:glassware', {
    title: 'Trail section has no products',
  })
  const ACK_AUTO_FIX = finding('directory:trail-empty-section:autumn-kitchen:tableware', {
    title: 'Trail section has no products (auto-fix)',
    route: 'auto_fix',
  })

  it('enqueues acknowledged findings but neither tickets nor auto-fixes them, and counts them', async () => {
    const slack = fakeSlack()
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-60' }))
    const triggerRepair = vi.fn(async () => {})
    const deps = timelineDeps(slack, [ACK_TICKET, ACK_AUTO_FIX, REPAIRABLE, REPORT_ONLY], {
      client: ledger.client,
      linearCreateTicket,
      triggerRepair,
      acknowledgements: ACKNOWLEDGEMENTS,
    })

    await runHealthAgent(deps)

    const enqueued = rpcCalls(ledger.client)
      .filter(([name]) => name === 'enqueue_health_fix')
      .map(([, params]) => params.p_fingerprint)
    expect(enqueued).toEqual(
      expect.arrayContaining([ACK_TICKET.fingerprint, ACK_AUTO_FIX.fingerprint]),
    )

    const titles = linearCreateTicket.mock.calls.map(
      (call) => (call as unknown as [{ title: string }])[0].title,
    )
    expect(titles).toEqual(['Health Agent — Report-only finding'])

    const request = (triggerRepair.mock.calls as unknown[][])[0][0] as RepairRequest
    expect(request.findings.map((f) => f.fingerprint)).toEqual([REPAIRABLE.fingerprint])

    expect(slack.events(PARENT_TS)[1]).toMatchObject({
      kind: 'findings',
      total: 4,
      autoFix: 1,
      ticket: 1,
      acknowledged: 2,
    })
  })

  it('findings event carries acknowledgedGroups grouped by ticket', async () => {
    const slack = fakeSlack()
    const deps = timelineDeps(slack, [ACK_TICKET, ACK_AUTO_FIX, REPORT_ONLY], {
      client: ticketClient().client,
      triggerRepair: vi.fn(async () => {}),
      acknowledgements: ACKNOWLEDGEMENTS,
    })

    await runHealthAgent(deps)

    expect(slack.events(PARENT_TS)[1]).toMatchObject({
      kind: 'findings',
      acknowledged: 2,
      acknowledgedGroups: [{ ticket: 'DEV-1903', until: '2026-12-31', count: 2 }],
    })
  })

  it('routes an acknowledged fingerprint normally once the acknowledgement has expired', async () => {
    const ledger = ticketClient()
    const linearCreateTicket = vi.fn(async () => ({ identifier: 'DEV-61' }))

    await runHealthAgent(baseDeps({
      client: ledger.client,
      logicalDate: '2027-01-01',
      acknowledgements: ACKNOWLEDGEMENTS,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [ACK_TICKET],
        }),
      ],
      linearCreateTicket,
    }))

    expect(linearCreateTicket).toHaveBeenCalledOnce()
    expect(ledger.reserved).toEqual([[`id:${ACK_TICKET.fingerprint}`]])
  })
})

describe('runHealthAgent — stale-ticket follow-up', () => {
  const DAY_MS = 86_400_000
  const ticketedDaysAgo = (days: number) =>
    new Date(RUN_NOW.getTime() - days * DAY_MS).toISOString()

  function followUpRun(days: number, createTicket?: RunHealthAgentDeps['linearCreateTicket']) {
    const ledger = ticketClient(
      { [REPORT_ONLY.fingerprint]: 'DEV-10' },
      { ticketedAt: { [REPORT_ONLY.fingerprint]: ticketedDaysAgo(days) } },
    )
    const linearCreateTicket = vi.fn(
      createTicket ?? (async () => ({ identifier: 'DEV-11' })),
    )
    const deps = baseDeps({
      client: ledger.client,
      registryOverride: [
        makeDetector({
          name: 'brand-invariants',
          source: 'directory',
          run: async () => [REPORT_ONLY],
        }),
      ],
      linearCreateTicket,
    })
    return { ledger, linearCreateTicket, deps }
  }

  it('files a follow-up ticket 15 days after the first one, referencing the old identifier', async () => {
    const { ledger, linearCreateTicket, deps } = followUpRun(15)

    await runHealthAgent(deps)

    expect(linearCreateTicket).toHaveBeenCalledOnce()
    const [spec] = linearCreateTicket.mock.calls[0] as unknown as [{ title: string; body: string }]
    expect(spec.title).toBe('Health Agent — Still firing — Report-only finding')
    expect(spec.body).toContain('Follow-up of DEV-10: still observed 15 days after it was ticketed.')
    expect(ledger.reserved).toEqual([[`id:${REPORT_ONLY.fingerprint}`]])
    expect(ledger.finalized).toEqual([
      { id: `id:${REPORT_ONLY.fingerprint}`, linearIdentifier: 'DEV-11' },
    ])
  })

  it('files no follow-up 13 days after the first ticket', async () => {
    const { ledger, linearCreateTicket, deps } = followUpRun(13)

    await runHealthAgent(deps)

    expect(linearCreateTicket).not.toHaveBeenCalled()
    expect(ledger.reserved).toEqual([])
  })

  it('restores the previous ticket link when the follow-up ticket cannot be created', async () => {
    const { ledger, deps } = followUpRun(15, async () => {
      throw new Error('linear down')
    })

    await runHealthAgent(deps)

    expect(ledger.released).toEqual([])
    expect(ledger.restored).toEqual([
      {
        id: `id:${REPORT_ONLY.fingerprint}`,
        ticketedAt: ticketedDaysAgo(15),
        linearIdentifier: 'DEV-10',
      },
    ])
  })
})
