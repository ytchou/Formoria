/**
 * E2E nightly agent server entry point tests.
 *
 * Verifies the boot sequence, exit codes on green runs and crashes.
 * All service modules are mocked — no real Supabase, Langfuse, or Playwright.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be at the top level (hoisted by Vitest)
// ---------------------------------------------------------------------------

const mockBootWorker = vi.fn<(opts: { agent: string; loadServices?: () => Promise<void> }) => Promise<void>>()
const mockLogWorkerBuildInfo = vi.fn()

vi.mock('@/worker-boot', () => ({
  bootWorker: (...args: Parameters<typeof mockBootWorker>) => mockBootWorker(...args),
  logWorkerBuildInfo: (...args: Parameters<typeof mockLogWorkerBuildInfo>) => mockLogWorkerBuildInfo(...args),
}))

// Stub process.exit to capture exit codes without killing the test runner
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e-agent server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBootWorker.mockResolvedValue(undefined)
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

    // Import triggers bootWorker + main() via void main()
    await import('../server.js')

    // Give the void main() microtask a tick to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(mockExit).toHaveBeenCalledWith(0)
  })

  it('server_exits_1_on_unrecoverable_failure', async () => {
    vi.resetModules()

    // bootWorker rejects — simulates unrecoverable boot failure
    mockBootWorker.mockRejectedValue(new Error('unrecoverable boot failure'))

    // The server wraps the boot in a try-catch and calls process.exit(1)
    await import('../server.js')

    // Give the async catch a tick to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(mockExit).toHaveBeenCalledWith(1)
  })
})
