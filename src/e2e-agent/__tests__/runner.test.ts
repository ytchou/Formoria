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
import type { ExecCommandFn, ExecResult } from '../runner'

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

type ExecOpts = Parameters<ExecCommandFn>[1]

const LINE_REPORTER_OUTPUT = 'Running 10 tests using 1 worker\n[1/10] e2e/brand-detail.spec.ts › test 1\n'

/**
 * Fake execCommand. Playwright returns line-reporter output on stdout; the
 * JSON report comes from the `cat e2e-report.json` call.
 */
function makeExec(opts: {
  install?: ExecResult
  playwright?: ExecResult
  reportFile?: ExecResult
} = {}) {
  const playwright = opts.playwright ?? { stdout: LINE_REPORTER_OUTPUT, stderr: '', exitCode: 0 }
  const reportFile = opts.reportFile ?? {
    stdout: JSON.stringify(makePlaywrightReport()),
    stderr: '',
    exitCode: 0,
  }
  return vi.fn(async (cmd: string, _opts?: ExecOpts): Promise<ExecResult> => {
    if (cmd.includes('ls-remote')) {
      return { stdout: 'abc123def456\trefs/heads/staging\n', stderr: '', exitCode: 0 }
    }
    if (cmd.includes('pnpm install') && opts.install) return opts.install
    if (cmd.includes('playwright test')) return playwright
    if (cmd.includes('e2e-report.json')) return reportFile
    return { stdout: '', stderr: '', exitCode: 0 }
  })
}

function reportCalls(execCommand: ReturnType<typeof makeExec>) {
  return execCommand.mock.calls.filter((call) => call[0].includes('e2e-report.json'))
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const report = overrides.report ?? makePlaywrightReport()
  return {
    execCommand: makeExec({
      reportFile: { stdout: JSON.stringify(report), stderr: '', exitCode: 0 },
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

  it('runner_writes_json_report_to_file_and_streams_line_output', async () => {
    const deps = makeDeps()
    const { runE2eSuite } = await import('../runner.js')

    await runE2eSuite({ runId: 'test-run-reporter', deps })

    const playwrightCall = deps.execCommand.mock.calls.find(
      (call) => call[0].includes('playwright test'),
    )
    expect(playwrightCall?.[0]).toContain('--reporter=line,json')
    const callOpts = playwrightCall?.[1]
    expect(callOpts?.streamOutput).toBe(true)
    expect(callOpts?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME).toMatch(/^\/.*e2e-report\.json$/)

    const reads = reportCalls(deps.execCommand)
    expect(reads).toHaveLength(1)
    expect(reads[0][0]).toBe('cat e2e-report.json')
    expect(reads[0][1]?.cwd).toBe('/tmp/e2e-run-test-run-reporter')
  })

  it('runner_parses_playwright_json_results', async () => {
    const report = makePlaywrightReport({ passed: 8, failed: 2 })
    const deps = makeDeps({ report })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-3', deps })

    expect(result.stats.expected).toBe(8)
    expect(result.stats.unexpected).toBe(2)
    expect(result.jsonReport).toBeDefined()
    expect(result.outcome).toBe('red')
  })

  it('runner_reports_green_outcome_on_passing_run', async () => {
    const deps = makeDeps()
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-green', deps })

    expect(result.outcome).toBe('green')
    expect(result.erroredReason).toBeUndefined()
  })

  it('runner_errors_without_reading_report_when_playwright_times_out', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: { stdout: LINE_REPORTER_OUTPUT, stderr: '', exitCode: 1, timedOut: true },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-timeout', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toContain('timed out after 20m')
    expect(result.failures).toEqual([])
    expect(result.unexpectedSkips).toEqual([])
    expect(result.stats.expected).toBe(0)
    expect(result.stagingSha).toBe('abc123def456')
    expect(result.outputTail).toContain('test 1')
    expect(reportCalls(deps.execCommand)).toHaveLength(0)
  })

  it('runner_errors_when_report_file_is_missing', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: { stdout: LINE_REPORTER_OUTPUT, stderr: 'boom', exitCode: 1 },
        reportFile: { stdout: '', stderr: 'No such file or directory', exitCode: 1 },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-missing-report', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toBe('Playwright JSON report missing or unparseable (exit 1)')
    expect(result.failures).toEqual([])
  })

  it('runner_errors_when_report_file_is_not_json', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        reportFile: { stdout: 'not json {', stderr: '', exitCode: 0 },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-bad-report', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toContain('missing or unparseable')
    expect(result.failures).toEqual([])
  })

  it('runner_errors_when_report_is_an_array', async () => {
    const deps = makeDeps({ report: [] })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-array-report', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toBe('Playwright JSON report missing or unparseable (exit 0)')
  })

  it('runner_errors_when_report_is_an_empty_object', async () => {
    const deps = makeDeps({ report: {} })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-empty-report', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toBe('Playwright reported no test results (exit 0)')
  })

  it('runner_errors_when_report_shows_zero_tests_ran', async () => {
    const deps = makeDeps({ report: makePlaywrightReport({ passed: 0 }) })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-zero-tests', deps })

    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toBe('Playwright reported no test results (exit 0)')
    expect(result.failures).toEqual([])
  })

  it('runner_throws_when_pnpm_install_times_out', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        install: { stdout: '', stderr: '', exitCode: 1, timedOut: true },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    await expect(runE2eSuite({ runId: 'test-run-install-timeout', deps }))
      .rejects.toThrow('pnpm install timed out after 3m')
    expect(
      deps.execCommand.mock.calls.some((call) => call[0].includes('playwright test')),
    ).toBe(false)
  })

  it('runner_output_tail_keeps_only_the_last_lines', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: {
          stdout: lines.join('\n\n'),
          stderr: '',
          exitCode: 1,
          timedOut: true,
        },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-tail', deps })

    const tailLines = (result.outputTail ?? '').split('\n')
    expect(tailLines).toHaveLength(20)
    expect(tailLines[0]).toBe('line 31')
    expect(tailLines[19]).toBe('line 50')
    expect(result.outputTail).not.toContain('line 30\n')
  })

  it('runner_output_tail_is_capped_to_1500_chars_keeping_the_end', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${'x'.repeat(200)} ${i + 1}`)
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: { stdout: lines.join('\n'), stderr: '', exitCode: 1, timedOut: true },
      }),
    })
    const { runE2eSuite } = await import('../runner.js')

    const result = await runE2eSuite({ runId: 'test-run-tail-cap', deps })

    expect(result.outputTail).toHaveLength(1500)
    expect(result.outputTail?.endsWith(' 20')).toBe(true)
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
    expect(result.outcome).toBe('red')
  })

  it('runner_fails_closed_when_playwright_exits_nonzero_with_passing_json', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: { stdout: LINE_REPORTER_OUTPUT, stderr: 'terminated', exitCode: 1 },
      }),
    })

    const { runE2eSuite } = await import('../runner.js')
    const result = await runE2eSuite({ runId: 'test-run-nonzero', deps })

    expect(result.stats.unexpected).toBe(0)
    expect(result.outcome).toBe('errored')
    expect(result.erroredReason).toBe('Playwright exited 1 with no test failures')
    expect(result.failures).toEqual([])
  })

  it('runner_reports_red_when_playwright_exits_nonzero_with_real_failures', async () => {
    const deps = makeDeps({
      execCommand: makeExec({
        playwright: { stdout: LINE_REPORTER_OUTPUT, stderr: '', exitCode: 1 },
        reportFile: {
          stdout: JSON.stringify(makePlaywrightReport({ passed: 9, failed: 1 })),
          stderr: '',
          exitCode: 0,
        },
      }),
    })

    const { runE2eSuite } = await import('../runner.js')
    const result = await runE2eSuite({ runId: 'test-run-nonzero-red', deps })

    expect(result.outcome).toBe('red')
    expect(result.erroredReason).toBeUndefined()
    expect(result.failures.length).toBeGreaterThan(0)
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

  it('runner_refuses_to_certify_staging_without_a_revision_header', async () => {
    const deps = makeDeps({
      fetchRevision: vi.fn(async () => ''),
    })

    const { runE2eSuite } = await import('../runner.js')
    await expect(runE2eSuite({
      runId: 'test-run-missing-revision',
      deps,
      revisionPollIntervalMs: 0,
      revisionPollMaxMs: 1,
    })).rejects.toThrow('Staging revision did not converge')

    expect(deps.cloneRepo).not.toHaveBeenCalled()
  })
})
