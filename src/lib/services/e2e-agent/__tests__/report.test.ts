import { describe, expect, it, vi } from 'vitest'
import { reportOutcome, type ReportDeps } from '../report'
import type { FrozenFailure, RepairResult, RunOutcome } from '../types'
import type { PublishInput, PublishResult } from '@/lib/adapters/github/app-publish'
import type { TicketSpec, TicketResult } from '@/lib/adapters/linear/create-ticket'

// withNodeSpan removed from report.ts — the graph wraps all nodes consistently

function makeFrozen(overrides: Partial<FrozenFailure> = {}): FrozenFailure {
  return {
    file: 'e2e/tests/search.spec.ts',
    title: 'search renders results',
    error: 'Locator not found',
    fingerprint: 'abc123',
    ...overrides,
  }
}

function makeRepair(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    changedFiles: [{ path: 'e2e/tests/search.spec.ts', content: '// fixed' }],
    branch: 'e2e-selfheal/fix-abc',
    baseSha: 'deadbeef',
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  return {
    publish: vi.fn<(input: PublishInput) => Promise<PublishResult>>().mockResolvedValue({
      ok: true,
      prUrl: 'https://github.com/ytchou/Formoria/pull/999',
      prNumber: 999,
    }),
    createTicket: vi.fn<(spec: TicketSpec) => Promise<TicketResult>>().mockResolvedValue({
      identifier: 'DEV-9999',
    }),
    postSlackMessage: vi.fn().mockResolvedValue({ ok: true, ts: '123' }),
    outcome: 'patched' as RunOutcome,
    repair: makeRepair(),
    frozenFailures: [makeFrozen()],
    runId: 'run-001',
    stagingSha: 'abc123def',
    ...overrides,
  }
}

describe('report_creates_incident_pr_via_app_publish', () => {
  it('calls publish with correct PublishInput for patched outcome', async () => {
    const deps = makeDeps({ outcome: 'patched' })

    await reportOutcome(deps)

    expect(deps.publish).toHaveBeenCalledTimes(1)
    const input = (deps.publish as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(input.baseSha).toBe('deadbeef')
    expect(input.files).toEqual([{ path: 'e2e/tests/search.spec.ts', content: '// fixed' }])
    expect(input.branch).toContain('e2e-selfheal')
    expect(input.labels).toContain('e2e-selfheal')
  })
})

describe('report_creates_linear_ticket_for_needs_human', () => {
  it('creates ticket with e2e_nightly label', async () => {
    const deps = makeDeps({ outcome: 'needs_human' })

    await reportOutcome(deps)

    expect(deps.createTicket).toHaveBeenCalledTimes(1)
    const spec = (deps.createTicket as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(spec.label).toBe('e2e_nightly')
    expect(spec.title).toBeTruthy()
    expect(spec.body).toBeTruthy()
  })
})

describe('report_posts_slack_notification_per_outcome', () => {
  it('posts Slack message for patched outcome with PR link', async () => {
    const deps = makeDeps({ outcome: 'patched' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.text).toContain('patched')
  })

  it('posts Slack message for needs_human outcome', async () => {
    const deps = makeDeps({ outcome: 'needs_human' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.text).toContain('needs_human')
  })

  it('posts Slack message for noise outcome', async () => {
    const deps = makeDeps({ outcome: 'noise' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
  })

  it('posts Slack message for fallback outcome', async () => {
    const deps = makeDeps({ outcome: 'fallback' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
  })
})

describe('report_skips_pr_for_noise_outcome', () => {
  it('does not call publish when outcome is noise', async () => {
    const deps = makeDeps({ outcome: 'noise' })

    await reportOutcome(deps)

    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('does not create a Linear ticket for noise', async () => {
    const deps = makeDeps({ outcome: 'noise' })

    await reportOutcome(deps)

    expect(deps.createTicket).not.toHaveBeenCalled()
  })
})
