/**
 * E2E nightly agent server entry point tests.
 *
 * Verifies the boot sequence, exit codes on green/failure/errored runs,
 * the red-run repair trigger posted into the run's Slack thread, and that
 * an errored run posts a warning without a repair request.
 *
 * Runner, deps, and Slack are mocked — no real Supabase, Slack, or Playwright.
 * The repair builders are pure and run for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be at the top level (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockBootWorker = vi.fn<
  (opts: {
    agent: string
    assertTarget?: () => void
    loadServices?: () => Promise<void>
  }) => Promise<void>
>()
const mockLogWorkerBuildInfo = vi.fn()
const mockValidateE2eAgentConfig = vi.fn()

vi.mock('@/worker-boot', () => ({
  bootWorker: (
    ...args: Parameters<typeof mockBootWorker>
  ) => mockBootWorker(...args),
  logWorkerBuildInfo: (
    ...args: Parameters<typeof mockLogWorkerBuildInfo>
  ) => mockLogWorkerBuildInfo(...args),
}))

vi.mock('@/e2e-agent/config', () => ({
  validateE2eAgentConfig: (...args: unknown[]) =>
    mockValidateE2eAgentConfig(...args),
}))

// Runner mock — at @/e2e-agent/ path, safe from boundary check
const mockRunE2eSuite = vi.fn()

vi.mock('@/e2e-agent/runner', () => ({
  runE2eSuite: (...args: unknown[]) => mockRunE2eSuite(...args),
}))

// Slack adapter mock — captures the start, summary, and repair messages
const mockPostMessage = vi.fn()

vi.mock('@/lib/adapters/slack/web-api', () => ({
  postMessage: (...args: unknown[]) => mockPostMessage(...args),
}))

// Deps builders mock — production wiring is tested elsewhere
vi.mock('@/e2e-agent/deps', () => ({
  buildRunnerDeps: () => ({
    execCommand: vi.fn(),
    cloneRepo: vi.fn(),
    fetchRevision: vi.fn(),
  }),
}))

// Stub process.exit to capture exit codes without killing the test runner
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as never)

const START_TS = '1700000000.000100'

function repairCalls() {
  return mockPostMessage.mock.calls.filter(([params]) =>
    String((params as { text: string }).text).includes('repair request'),
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greenRunResult() {
  return {
    outcome: 'green',
    failures: [],
    unexpectedSkips: [],
    stats: {
      expected: 10,
      unexpected: 0,
      skipped: 0,
      flaky: 0,
      duration: 5000,
    },
    jsonReport: {},
    stagingSha: 'abc123',
  }
}

function failingRunResult() {
  return {
    outcome: 'red',
    failures: [
      {
        file: 'e2e/brands.spec.ts',
        title: 'brand page loads',
        error: 'Element not found',
      },
    ],
    unexpectedSkips: [],
    stats: {
      expected: 10,
      unexpected: 1,
      skipped: 0,
      flaky: 0,
      duration: 8000,
    },
    jsonReport: {},
    stagingSha: 'def456',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e-agent server', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: bootWorker calls loadServices to populate module vars
    mockBootWorker.mockImplementation(async (opts) => {
      opts.assertTarget?.()
      if (opts.loadServices) await opts.loadServices()
    })

    // Default: green run
    mockRunE2eSuite.mockResolvedValue(greenRunResult())
    mockPostMessage.mockResolvedValue({ ok: true, ts: START_TS })
    vi.stubEnv('OPS_AGENT_SLACK_BOT_ID', 'U_OPS_BOT')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('server_boots_with_e2e_nightly_agent_name', async () => {
    vi.resetModules()

    await import('../server.js')

    expect(mockBootWorker).toHaveBeenCalledOnce()
    expect(mockBootWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'e2e-nightly',
        assertTarget: expect.any(Function),
      }),
    )
    expect(mockValidateE2eAgentConfig).toHaveBeenCalledOnce()
  })

  it('server_exits_0_on_green_run', async () => {
    vi.resetModules()

    await import('../server.js')
    // Give the void main() microtask a tick to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(mockRunE2eSuite).toHaveBeenCalledTimes(1)
    expect(repairCalls()).toHaveLength(0)
    expect(mockExit).toHaveBeenCalledWith(0)
  })

  it('server_exits_1_on_unrecoverable_failure', async () => {
    vi.resetModules()

    // bootWorker rejects — simulates unrecoverable boot failure
    mockBootWorker.mockRejectedValue(new Error('unrecoverable boot failure'))

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('server_posts_repair_trigger_in_thread_on_red_run', async () => {
    vi.resetModules()

    mockRunE2eSuite.mockResolvedValue(failingRunResult())

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    expect(mockRunE2eSuite).toHaveBeenCalledTimes(1)
    const calls = repairCalls()
    expect(calls).toHaveLength(1)
    const params = calls[0][0] as {
      text: string
      blocks: Array<{ type: string; text?: { text: string } }>
      threadTs?: string
    }
    expect(params.threadTs).toBe(START_TS)
    expect(params.text).toContain('<@U_OPS_BOT> E2E Agent repair request')
    expect(params.text).toContain('"agent":"e2e-agent"')
    expect(params.text).toContain('brand page loads')
    expect(params.blocks[0].text?.text).toBe('E2E Agent Repair Request')
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('server_includes_unexpected_skips_in_repair_request', async () => {
    vi.resetModules()

    mockRunE2eSuite.mockResolvedValue({
      ...greenRunResult(),
      outcome: 'red',
      unexpectedSkips: [
        {
          file: 'e2e/tests/auth-password-reset.spec.ts',
          title: 'unexpected auth skip',
          project: 'deep',
        },
      ],
    })

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    const calls = repairCalls()
    expect(calls).toHaveLength(1)
    const text = (calls[0][0] as { text: string }).text
    expect(text).toContain('"kind":"unexpected_skip"')
    expect(text).toContain('e2e/tests/auth-password-reset.spec.ts')
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('server_warns_when_repair_request_drops_findings', async () => {
    vi.resetModules()

    const count = 60
    mockRunE2eSuite.mockResolvedValue({
      ...failingRunResult(),
      failures: Array.from({ length: count }, (_, i) => ({
        file: `e2e/tests/spec-${i}.spec.ts`,
        title: `failing test number ${i}`,
        error: 'e'.repeat(5000),
      })),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    const calls = repairCalls()
    expect(calls).toHaveLength(1)
    expect((calls[0][0] as { text: string }).text.length).toBeLessThan(40_000)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/repair request dropped \d+ of 60 findings/),
    )
    expect(mockExit).toHaveBeenCalledWith(1)
    warn.mockRestore()
  })

  it('server_posts_warning_and_skips_repair_on_errored_run', async () => {
    vi.resetModules()

    mockRunE2eSuite.mockResolvedValue({
      outcome: 'errored',
      erroredReason: 'Playwright timed out after 20m',
      failures: [],
      unexpectedSkips: [],
      stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0, duration: 0 },
      jsonReport: {},
      stagingSha: 'fed9876543',
      outputTail: '[42/97] e2e/tests/slow.spec.ts › stalls ```fence```',
    })

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    const erroredCalls = mockPostMessage.mock.calls.filter(([params]) =>
      String((params as { text: string }).text).startsWith('⚠️ E2E run errored'),
    )
    expect(erroredCalls).toHaveLength(1)
    const params = erroredCalls[0][0] as {
      text: string
      blocks: Array<{ type: string; text?: { text: string } }>
      threadTs?: string
    }
    expect(params.text).toBe('⚠️ E2E run errored: Playwright timed out after 20m')
    expect(params.threadTs).toBe(START_TS)
    expect(JSON.stringify(params.blocks)).toContain('fed9876')
    expect(JSON.stringify(params.blocks)).toContain('e2e/tests/slow.spec.ts')
    const tailBlock = params.blocks[params.blocks.length - 1]
    expect(tailBlock.text?.text).toBe(
      "```\n[42/97] e2e/tests/slow.spec.ts › stalls '''fence'''\n```",
    )

    // Start message + errored warning only — no ❌ summary, no repair trigger
    expect(mockPostMessage).toHaveBeenCalledTimes(2)
    expect(repairCalls()).toHaveLength(0)
    expect(mockExit).toHaveBeenCalledWith(1)
    expect(mockExit).not.toHaveBeenCalledWith(0)
  })
})
