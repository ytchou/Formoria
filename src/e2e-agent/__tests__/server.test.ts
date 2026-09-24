/**
 * E2E nightly agent server entry point tests.
 *
 * Verifies the boot sequence, exit codes on green/failure/errored runs,
 * the red-run repair trigger posted into the run's Slack thread, and that
 * an errored run posts a warning without a repair request.
 *
 * Also covers dispatch routing (DEV-1854): a claimed dispatch sends every
 * message into the requester's thread plus an audit pointer in the alerts
 * channel; no dispatch keeps today's alerts-channel behavior.
 *
 * Runner, deps, Slack, and the dispatch client are mocked — no real Supabase,
 * Slack, Playwright, or production endpoint.
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
const mockUpdateMessage = vi.fn()

vi.mock('@/lib/adapters/slack/web-api', () => ({
  postMessage: (...args: unknown[]) => mockPostMessage(...args),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
}))

// Dispatch client mock — adapter path, safe from boundary check
const mockClaimDispatch = vi.fn()
const mockCompleteDispatch = vi.fn()

vi.mock('@/lib/adapters/ops-dispatch/client', () => ({
  claimDispatch: (...args: unknown[]) => mockClaimDispatch(...args),
  completeDispatch: (...args: unknown[]) => mockCompleteDispatch(...args),
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
const ALERTS_CHANNEL = 'C_ALERTS'
const DISPATCH = {
  id: '22222222-2222-4222-8222-222222222222',
  channelId: 'C_OPS',
  threadTs: '1700000000.000900',
  requesterId: 'U_REQUESTER',
}

type PostParams = {
  channel: string
  text: string
  threadTs?: string
  blocks?: unknown[]
}

function postCalls(): PostParams[] {
  return mockPostMessage.mock.calls.map(([params]) => params as PostParams)
}

function pointerCalls(): PostParams[] {
  return postCalls().filter((p) => p.text.includes('requested by'))
}

async function runServer() {
  vi.resetModules()
  await import('../server.js')
  await new Promise((r) => setTimeout(r, 50))
}

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
    mockUpdateMessage.mockResolvedValue({ ok: true })
    mockClaimDispatch.mockResolvedValue({ dispatch: null, reason: 'unconfigured' })
    mockCompleteDispatch.mockResolvedValue({ ok: true, updated: true })
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

  // -------------------------------------------------------------------------
  // Dispatch routing (DEV-1854)
  // -------------------------------------------------------------------------

  it('server_routes_all_posts_to_claimed_thread_and_posts_pointer', async () => {
    vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
    mockClaimDispatch.mockResolvedValue({ dispatch: DISPATCH })
    mockRunE2eSuite.mockResolvedValue(failingRunResult())

    await runServer()

    expect(mockClaimDispatch).toHaveBeenCalledTimes(1)
    const runId = mockClaimDispatch.mock.calls[0][0] as string
    expect(mockRunE2eSuite).toHaveBeenCalledWith(
      expect.objectContaining({ runId }),
    )

    const pointers = pointerCalls()
    expect(pointers).toHaveLength(1)
    expect(pointers[0].channel).toBe(ALERTS_CHANNEL)
    expect(pointers[0].threadTs).toBeUndefined()
    expect(pointers[0].text).toContain(runId.slice(0, 8))
    expect(pointers[0].text).toContain('<@U_REQUESTER>')
    expect(pointers[0].text).toContain('C_OPS/p1700000000000900')

    const runPosts = postCalls().filter((p) => !p.text.includes('requested by'))
    // start + summary + repair request
    expect(runPosts).toHaveLength(3)
    for (const post of runPosts) {
      expect(post.channel).toBe('C_OPS')
      expect(post.threadTs).toBe(DISPATCH.threadTs)
    }
    expect(runPosts[0].text).toContain('E2E Nightly')
    expect(repairCalls()).toHaveLength(1)
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('server_keeps_alerts_channel_routing_without_dispatch', async () => {
    vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
    mockClaimDispatch.mockResolvedValue({ dispatch: null, reason: 'http-404' })
    mockRunE2eSuite.mockResolvedValue(failingRunResult())

    await runServer()

    const posts = postCalls()
    // start + summary + repair request, no pointer
    expect(posts).toHaveLength(3)
    expect(pointerCalls()).toHaveLength(0)
    for (const post of posts) expect(post.channel).toBe(ALERTS_CHANNEL)
    expect(posts[0].threadTs).toBeUndefined()
    expect(posts[1].threadTs).toBe(START_TS)
    expect(posts[2].threadTs).toBe(START_TS)
    expect(mockCompleteDispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['green', greenRunResult, '✅', 0],
    ['red', failingRunResult, '❌', 1],
  ] as const)(
    'server_updates_start_message_on_%s_outcome_in_cron_mode',
    async (_name, makeResult, emoji, exit) => {
      vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
      mockRunE2eSuite.mockResolvedValue(makeResult())

      await runServer()

      expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
      const update = mockUpdateMessage.mock.calls[0][0] as PostParams & { ts: string }
      expect(update.channel).toBe(ALERTS_CHANNEL)
      expect(update.ts).toBe(START_TS)
      expect(update.text).toContain(emoji)
      expect(JSON.stringify(update.blocks)).toContain(emoji)
      expect(mockCompleteDispatch).not.toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(exit)
    },
  )

  it('server_updates_start_and_pointer_and_completes_when_claimed', async () => {
    vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
    mockClaimDispatch.mockResolvedValue({ dispatch: DISPATCH })
    const START_REPLY_TS = '1700000000.000555'
    const POINTER_TS = '1700000000.000777'
    mockPostMessage.mockImplementation(async (params: PostParams) => ({
      ok: true,
      ts: params.channel === ALERTS_CHANNEL ? POINTER_TS : START_REPLY_TS,
    }))
    mockRunE2eSuite.mockResolvedValue({
      outcome: 'errored',
      erroredReason: 'Playwright timed out after 20m',
      failures: [],
      unexpectedSkips: [],
      stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0, duration: 0 },
      jsonReport: {},
      stagingSha: 'fed9876543',
    })

    await runServer()

    const updates = mockUpdateMessage.mock.calls.map(
      ([p]) => p as PostParams & { ts: string },
    )
    expect(updates).toHaveLength(2)
    const startUpdate = updates.find((u) => u.channel === 'C_OPS')
    const pointerUpdate = updates.find((u) => u.channel === ALERTS_CHANNEL)
    expect(startUpdate?.ts).toBe(START_REPLY_TS)
    expect(startUpdate?.text).toContain('⚠️')
    expect(pointerUpdate?.ts).toBe(POINTER_TS)
    expect(pointerUpdate?.text).toContain('⚠️')
    expect(pointerUpdate?.text).toContain('requested by')

    const runId = mockClaimDispatch.mock.calls[0][0] as string
    expect(mockCompleteDispatch).toHaveBeenCalledTimes(1)
    expect(mockCompleteDispatch).toHaveBeenCalledWith({
      dispatchId: DISPATCH.id,
      runId,
      outcome: 'errored',
    })
    // completion happens before exit
    expect(mockCompleteDispatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockExit.mock.invocationCallOrder[mockExit.mock.invocationCallOrder.length - 1],
    )
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('server_completes_with_crashed_when_runner_throws', async () => {
    mockClaimDispatch.mockResolvedValue({ dispatch: DISPATCH })
    mockRunE2eSuite.mockRejectedValue(new Error('boom'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await runServer()

    expect(mockCompleteDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchId: DISPATCH.id, outcome: 'crashed' }),
    )
    expect(mockExit).toHaveBeenCalledWith(1)
    error.mockRestore()
  })

  it('server_falls_back_to_alerts_channel_when_claimed_thread_post_fails', async () => {
    vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
    mockClaimDispatch.mockResolvedValue({ dispatch: DISPATCH })
    const POINTER_TS = '1700000000.000777'
    mockPostMessage.mockImplementation(async (params: PostParams) => {
      if (params.channel === ALERTS_CHANNEL) return { ok: true, ts: POINTER_TS }
      // Summary into the claimed thread fails; everything else succeeds.
      if (params.text.includes('passed')) return { ok: false, error: 'not_in_channel' }
      return { ok: true, ts: START_TS }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runServer()

    const summaryPosts = postCalls().filter((p) => p.text.includes('passed'))
    expect(summaryPosts).toHaveLength(2)
    expect(summaryPosts[0].channel).toBe('C_OPS')
    expect(summaryPosts[0].threadTs).toBe(DISPATCH.threadTs)
    expect(summaryPosts[1].channel).toBe(ALERTS_CHANNEL)
    expect(summaryPosts[1].threadTs).toBe(POINTER_TS)
    expect(mockExit).toHaveBeenCalledWith(0)
    warn.mockRestore()
  })

  it('server_prefixes_unthreaded_fallback_with_run_id_when_pointer_fails', async () => {
    vi.stubEnv('SLACK_E2E_CHANNEL', ALERTS_CHANNEL)
    mockClaimDispatch.mockResolvedValue({ dispatch: DISPATCH })
    mockPostMessage.mockImplementation(async (params: PostParams) => {
      // The audit pointer fails, so there is no pointer to thread under.
      if (params.text.includes('requested by')) return { ok: false, error: 'rate_limited' }
      // Summary into the claimed thread fails; everything else succeeds.
      if (params.channel === 'C_OPS' && params.text.includes('passed')) {
        return { ok: false, error: 'not_in_channel' }
      }
      return { ok: true, ts: START_TS }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runServer()

    const runId = mockClaimDispatch.mock.calls[0][0] as string
    const summaryPosts = postCalls().filter((p) => p.text.includes('passed'))
    expect(summaryPosts).toHaveLength(2)
    expect(summaryPosts[0].channel).toBe('C_OPS')
    expect(summaryPosts[0].text.startsWith('E2E run')).toBe(false)
    const fallback = summaryPosts[1]
    expect(fallback.channel).toBe(ALERTS_CHANNEL)
    expect(fallback.threadTs).toBeUndefined()
    expect(fallback.text.startsWith(`E2E run \`${runId.slice(0, 8)}\`: `)).toBe(true)
    expect(mockExit).toHaveBeenCalledWith(0)
    warn.mockRestore()
  })
})
