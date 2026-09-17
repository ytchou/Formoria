import { describe, expect, it } from 'vitest'

import {
  groupFindings,
  selectForRepair,
  MAX_INVESTIGATIONS_PER_RUN,
  type RepairCandidate,
} from '../grouping'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidate(overrides: Partial<RepairCandidate> = {}): RepairCandidate {
  return {
    id: 'fix-1',
    fingerprint: 'quality:dead-code:src/lib/utils.ts:unusedFn',
    source: 'quality',
    title: 'Knip exports: unusedFn',
    evidence: {
      check: 'dead-code',
      kind: 'exports',
      file: 'src/lib/utils.ts',
      symbol: 'unusedFn',
    },
    changedFiles: ['src/lib/utils.ts'],
    mergePolicy: 'automatic' as const,
    ticketedAt: null,
    regressedAt: null,
    topInAppFrame: null,
    testFile: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repair grouping', () => {
  it('sentry issues sharing the top in-app frame are grouped into one problem; failing tests group by file', () => {
    const findings = [
      candidate({
        id: 'sentry-1',
        fingerprint: 'sentry:issue:100',
        source: 'sentry',
        title: 'TypeError in cart',
        topInAppFrame: 'src/cart/total.ts:42',
      }),
      candidate({
        id: 'sentry-2',
        fingerprint: 'sentry:issue:101',
        source: 'sentry',
        title: 'TypeError in cart (variant)',
        topInAppFrame: 'src/cart/total.ts:42',
      }),
      candidate({
        id: 'sentry-3',
        fingerprint: 'sentry:issue:102',
        source: 'sentry',
        title: 'ReferenceError in auth',
        topInAppFrame: 'src/auth/login.ts:10',
      }),
      candidate({
        id: 'test-1',
        fingerprint: 'quality:full-unit-suite:src/cart/total.test.ts::sum works',
        source: 'quality',
        title: 'Vitest failure: sum works',
        testFile: 'src/cart/total.test.ts',
      }),
      candidate({
        id: 'test-2',
        fingerprint: 'quality:full-unit-suite:src/cart/total.test.ts::handles empty',
        source: 'quality',
        title: 'Vitest failure: handles empty',
        testFile: 'src/cart/total.test.ts',
      }),
      candidate({
        id: 'test-3',
        fingerprint: 'quality:full-unit-suite:src/auth/login.test.ts::validates',
        source: 'quality',
        title: 'Vitest failure: validates',
        testFile: 'src/auth/login.test.ts',
      }),
    ]

    const groups = groupFindings(findings)

    // sentry-1 and sentry-2 share top frame → one group
    const sentryGroups = groups.filter((g) => g.source === 'sentry')
    expect(sentryGroups).toHaveLength(2) // two distinct top frames

    const cartSentryGroup = sentryGroups.find((g) =>
      g.members.some((m) => m.id === 'sentry-1'),
    )
    expect(cartSentryGroup).toBeDefined()
    expect(cartSentryGroup!.members).toHaveLength(2)
    expect(cartSentryGroup!.members.map((m) => m.id)).toEqual(
      expect.arrayContaining(['sentry-1', 'sentry-2']),
    )

    // test-1 and test-2 share the test file → one group
    const testGroups = groups.filter(
      (g) => g.source === 'quality' && g.members.some((m) => m.testFile),
    )
    const cartTestGroup = testGroups.find((g) =>
      g.members.some((m) => m.id === 'test-1'),
    )
    expect(cartTestGroup).toBeDefined()
    expect(cartTestGroup!.members).toHaveLength(2)

    // test-3 is in its own group
    const authTestGroup = testGroups.find((g) =>
      g.members.some((m) => m.id === 'test-3'),
    )
    expect(authTestGroup).toBeDefined()
    expect(authTestGroup!.members).toHaveLength(1)
  })

  it('only fingerprints never ticketed or regressed are selected, capped per run', () => {
    const findings = [
      // ticketed → excluded
      candidate({
        id: 'ticketed',
        fingerprint: 'quality:dead-code:f1',
        ticketedAt: '2026-09-01T00:00:00Z',
      }),
      // regressed → excluded
      candidate({
        id: 'regressed',
        fingerprint: 'quality:dead-code:f2',
        regressedAt: '2026-09-01T00:00:00Z',
      }),
      // eligible
      candidate({ id: 'ok-1', fingerprint: 'quality:dead-code:a1' }),
      candidate({ id: 'ok-2', fingerprint: 'quality:dead-code:a2' }),
      candidate({ id: 'ok-3', fingerprint: 'quality:dead-code:a3' }),
      candidate({ id: 'ok-4', fingerprint: 'quality:dead-code:a4' }),
    ]

    const selected = selectForRepair(findings)

    // ticketed and regressed should be excluded
    const selectedIds = selected.map((s) => s.id)
    expect(selectedIds).not.toContain('ticketed')
    expect(selectedIds).not.toContain('regressed')

    // capped at MAX_INVESTIGATIONS_PER_RUN
    expect(selected.length).toBeLessThanOrEqual(MAX_INVESTIGATIONS_PER_RUN)
    expect(MAX_INVESTIGATIONS_PER_RUN).toBe(3)
  })
})
