/**
 * E2E nightly agent runner tests.
 *
 * All I/O is injected via the DI seam — no real git, no real Playwright,
 * no real network calls.
 */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/adapters/github/app-auth', () => ({
  getInstallationToken: vi.fn(async () => 'ghp_test_token'),
}))

import type { ActionableReportFailure } from '@/lib/services/e2e-report/gate'

const mockEvaluateSkips = vi.fn(
  (_report: unknown, _manifest: unknown): ActionableReportFailure[] => [],
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlaywrightReport(opts: { passed?: number; failed?: number; skipped?: number } = {}) {
  const { passed = 10, failed = 0, skipped = 0 } = opts
  return {
    stats: {
      expected: passed,
      unexpected: failed,
      skipped,
      flaky: 0,
      duration: 120_000,
    },
    suites: [
      {
        title: 'suite-1',
        file: 'e2e/brand-detail.spec.ts',
        specs: [
          ...Array.from({ length: passed }, (_, i) => ({
            title: `test ${i + 1}`,
            tests: [{ status: 'expected', projectName: 'deep', results: [{ status: 'passed' }] }],
          })),
          ...Array.from({ length: failed }, (_, i) => ({
            title: `failing test ${i + 1}`,
            tests: [{ status: 'unexpected', projectName: 'deep', results: [{ status: 'failed' }], error: { message: `assertion failed ${i + 1}` } }],
          })),
        ],
      },
    ],
    errors: Array.from({ length: failed }, (_, i) => ({
      message: `assertion failed ${i + 1}`,
      location: { file: 'e2e/brand-detail.spec.ts', line: 10 + i },
    })),
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const report = overrides.report ?? makePlaywrightReport()
  return {
    execCommand: vi.fn(async (cmd: string, _opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }) => {
      if (cmd.includes('ls-remote')) {
        return { stdout: 'abc123def456\trefs/heads/staging\n', stderr: '', exitCode: 0 }
      }
      if (cmd.includes('playwright test')) {
        return { stdout: JSON.stringify(report), stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }),
    cloneRepo: vi.fn(async () => '/tmp/e2e-run-test-123'),
    fetchRevision: vi.fn(async () => 'abc123def456'),
    evaluateSkips: mockEvaluateSkips,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e-agent runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEvaluateSkips.mockReturnValue([])
  })

  afterEach(() => vi.unstubAllEnvs())

  it('runner_clones_staging_at_resolved_sha', async () => {
    const deps = makeDeps()
    const { runE2eSuite } = await import('../runner.js')

    await runE2eSuite({ runId: 'test-run-1', deps })

    expect(deps.cloneRepo).toHaveBeenCalledOnce()
    expect(deps.cloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'abc123def456',
        shallow: true,
      }),
    )
  })

  it('runner_runs_playwright_with_correct_env', async () => {
    vi.stubEnv('E2E_STAGING_SESSION_SECRET', 'runner-secret-with-at-least-thirty-two-bytes')
    const deps = makeDeps()
    const { runE2eSuite } = await import('../runner.js')

    await runE2eSuite({ runId: 'test-run-2', deps })

    // Find the playwright exec call
    const playwrightCall = deps.execCommand.mock.calls.find(
      (call) => call[0].includes('playwright test'),
    )
    expect(playwrightCall).toBeDefined()

    // Verify env vars are passed (second arg is options with env)
    const callOpts = playwrightCall?.[1] as Record<string, unknown> | undefined
    const env = callOpts?.env as Record<string, string> | undefined
    expect(env?.FORMORIA_DEPLOYMENT_ENV).toBe('staging')
    expect(env?.CI).toBe('true')
    expect(env?.E2E_STAGING_SESSION_SECRET).toBe(
      'runner-secret-with-at-least-thirty-two-bytes',
    )
    expect(callOpts?.timeoutMs).toBe(20 * 60_000)
  })

  it('runner_parses_playwright_json_results', async () => {
    const report = makePlaywrightReport({ passed: 8, failed: 2 })
    const deps = makeDeps({ report })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-3', deps })

    expect(result.stats.expected).toBe(8)
    expect(result.stats.unexpected).toBe(2)
    expect(result.jsonReport).toBeDefined()
  })

  it('runner_evaluates_unexpected_skips', async () => {
    const report = makePlaywrightReport({ skipped: 1 })
    const deps = makeDeps({ report })
    mockEvaluateSkips.mockReturnValue([
      { file: 'e2e/signup.spec.ts', title: 'signup flow', project: 'deep' } satisfies ActionableReportFailure,
    ])

    const { runE2eSuite } = await import('../runner.js')
    const result = await runE2eSuite({ runId: 'test-run-4', deps })

    expect(mockEvaluateSkips).toHaveBeenCalledWith(
      report,
      expect.objectContaining({ version: 1 }),
    )
    expect(result.unexpectedSkips).toHaveLength(1)
    expect(result.unexpectedSkips[0].title).toBe('signup flow')
    expect(result.passed).toBe(false)
  })

  it('runner_fails_closed_when_playwright_exits_nonzero_with_passing_json', async () => {
    const report = makePlaywrightReport()
    const deps = makeDeps()
    deps.execCommand.mockImplementation(async (cmd: string) => {
      if (cmd.includes('ls-remote')) {
        return { stdout: 'abc123def456\trefs/heads/staging\n', stderr: '', exitCode: 0 }
      }
      if (cmd.includes('playwright test')) {
        return { stdout: JSON.stringify(report), stderr: 'terminated', exitCode: 1 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    const { runE2eSuite } = await import('../runner.js')
    const result = await runE2eSuite({ runId: 'test-run-nonzero', deps })

    expect(result.stats.unexpected).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('runner_waits_for_staging_revision', async () => {
    let callCount = 0
    const deps = makeDeps({
      // First two calls return wrong revision, third matches
      fetchRevision: vi.fn(async () => {
        callCount++
        if (callCount < 3) return 'old-sha'
        return 'abc123def456'
      }),
    })

    const { runE2eSuite } = await import('../runner.js')
    await runE2eSuite({
      runId: 'test-run-5',
      deps,
      revisionPollIntervalMs: 0,
    })

    expect(deps.fetchRevision).toHaveBeenCalledTimes(3)
  })
})
