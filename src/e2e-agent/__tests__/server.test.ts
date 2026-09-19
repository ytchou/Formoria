/**
 * E2E nightly agent server entry point tests.
 *
 * Verifies the boot sequence, exit codes on green/failure runs,
 * and the runner → self-heal graph wiring.
 *
 * All service modules are mocked — no real Supabase, Langfuse, or Playwright.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be at the top level (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockBootWorker = vi.fn<
  (opts: {
    agent: string
    loadServices?: () => Promise<void>
  }) => Promise<void>
>()
const mockLogWorkerBuildInfo = vi.fn()

vi.mock('@/worker-boot', () => ({
  bootWorker: (
    ...args: Parameters<typeof mockBootWorker>
  ) => mockBootWorker(...args),
  logWorkerBuildInfo: (
    ...args: Parameters<typeof mockLogWorkerBuildInfo>
  ) => mockLogWorkerBuildInfo(...args),
}))

// Runner mock — at @/e2e-agent/ path, safe from boundary check
const mockRunE2eSuite = vi.fn()

vi.mock('@/e2e-agent/runner', () => ({
  runE2eSuite: (...args: unknown[]) => mockRunE2eSuite(...args),
}))

// Self-heal graph mock — re-exported at @/e2e-agent/ path
const mockRunSelfHealGraph = vi.fn()

vi.mock('@/e2e-agent/self-heal', () => ({
  runSelfHealGraph: (...args: unknown[]) => mockRunSelfHealGraph(...args),
}))

// Deps builders mock — production wiring is tested elsewhere
vi.mock('@/e2e-agent/deps', () => ({
  buildRunnerDeps: () => ({
    execCommand: vi.fn(),
    cloneRepo: vi.fn(),
    fetchRevision: vi.fn(),
  }),
  buildSelfHealDeps: () => ({
    createClient: vi.fn(),
    fetchPrompt: vi.fn(),
    publish: vi.fn(),
    createTicket: vi.fn(),
    postSlackMessage: vi.fn(),
    cloneAndRunTests: vi.fn(),
  }),
}))

// Stub process.exit to capture exit codes without killing the test runner
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as never)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greenRunResult() {
  return {
    passed: true,
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
    passed: false,
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
      if (opts.loadServices) await opts.loadServices()
    })

    // Default: green run
    mockRunE2eSuite.mockResolvedValue(greenRunResult())
    mockRunSelfHealGraph.mockResolvedValue({ outcome: 'patched', cycle: 1 })
  })

  it('server_boots_with_e2e_nightly_agent_name', async () => {
    vi.resetModules()

    await import('../server.js')

    expect(mockBootWorker).toHaveBeenCalledOnce()
    expect(mockBootWorker).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'e2e-nightly' }),
    )
  })

  it('server_exits_0_on_green_run', async () => {
    vi.resetModules()

    await import('../server.js')
    // Give the void main() microtask a tick to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(mockRunE2eSuite).toHaveBeenCalledTimes(1)
    expect(mockRunSelfHealGraph).not.toHaveBeenCalled()
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

  it('server_main_runs_suite_then_selfheal_on_failures', async () => {
    vi.resetModules()

    mockRunE2eSuite.mockResolvedValue(failingRunResult())
    mockRunSelfHealGraph.mockResolvedValue({ outcome: 'patched', cycle: 1 })

    await import('../server.js')
    await new Promise((r) => setTimeout(r, 50))

    // Runner was called
    expect(mockRunE2eSuite).toHaveBeenCalledTimes(1)
    // Graph was called because there were failures
    expect(mockRunSelfHealGraph).toHaveBeenCalledTimes(1)
    // Patched outcome → exit 0
    expect(mockExit).toHaveBeenCalledWith(0)
  })
})
