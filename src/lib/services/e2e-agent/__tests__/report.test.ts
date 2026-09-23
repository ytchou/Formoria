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
  it('creates ticket with Bug label', async () => {
    const deps = makeDeps({ outcome: 'needs_human' })

    await reportOutcome(deps)

    expect(deps.createTicket).toHaveBeenCalledTimes(1)
    const spec = (deps.createTicket as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(spec.label).toBe('5bb8cb23-6463-436b-befc-0463806d13b6')
    expect(spec.title).toBeTruthy()
    expect(spec.body).toBeTruthy()
  })
})

describe('report_posts_slack_notification_per_outcome', () => {
  it('posts Block Kit for patched outcome with PR link', async () => {
    const deps = makeDeps({ outcome: 'patched' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.text).toContain('patched')
    expect(params.blocks).toBeDefined()
    expect(params.blocks[0].type).toBe('header')
    expect(params.blocks[0].text.text).toContain('Patched')
    expect(params.blocks[1].text.text).toContain('fixed')
  })

  it('posts Block Kit for needs_human outcome', async () => {
    const deps = makeDeps({ outcome: 'needs_human' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.text).toContain('needs_human')
    expect(params.blocks).toBeDefined()
    expect(params.blocks[0].text.text).toContain('Needs Human')
  })

  it('posts Block Kit for noise outcome', async () => {
    const deps = makeDeps({ outcome: 'noise' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.blocks).toBeDefined()
    expect(params.blocks[0].text.text).toContain('Noise')
    expect(params.blocks[1].text.text).toContain('transient')
  })

  it('posts Block Kit for fallback outcome with ticket', async () => {
    const deps = makeDeps({ outcome: 'fallback' })

    await reportOutcome(deps)

    expect(deps.postSlackMessage).toHaveBeenCalledTimes(1)
    const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(params.blocks).toBeDefined()
    expect(params.blocks[0].text.text).toContain('Fallback')
    expect(params.blocks[1].text.text).toContain('DEV-9999')
  })

  it('all outcomes include context block with runId and SHA', async () => {
    for (const outcome of ['patched', 'noise', 'fallback'] as RunOutcome[]) {
      const deps = makeDeps({ outcome })
      await reportOutcome(deps)
      const params = (deps.postSlackMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const contextBlock = params.blocks[params.blocks.length - 1]
      expect(contextBlock.type).toBe('context')
      expect(contextBlock.elements[0].text).toContain('run-001')
    }
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
