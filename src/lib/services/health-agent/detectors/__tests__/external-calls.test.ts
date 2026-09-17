import { describe, expect, it } from 'vitest'
import { externalCallsDetector } from '../external-calls'
import type { DetectorContext } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides?: Partial<DetectorContext>): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 60_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

type SpanRow = {
  span_id: string
  provider: string
  operation: string | null
  terminal_status: string | null
  started_at: string
  finished_at: string | null
}

function fakeSupabase(rows: SpanRow[]) {
  return {
    from(table: string) {
      if (table !== 'external_call_audit_spans') {
        throw new Error(`Unexpected table: ${table}`)
      }
      let filtered = [...rows]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] === val,
          )
          return builder
        },
        neq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] !== val,
          )
          return builder
        },
        is: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as unknown as Record<string, unknown>)[_col] === val,
          )
          return builder
        },
        gte: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as unknown as Record<string, unknown>)[_col] as string) >=
              (val as string),
          )
          return builder
        },
        lt: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as unknown as Record<string, unknown>)[_col] as string) <
              (val as string),
          )
          return builder
        },
        order: () => builder,
        range: (_from: number, _to: number) =>
          Promise.resolve({ data: filtered.slice(_from, _to + 1), error: null }),
      }
      return builder
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('external-calls detector', () => {
  it('reports a provider whose non-succeeded share crosses its threshold, ignoring started rows', async () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const rows: SpanRow[] = [
      // 4 failed, 1 succeeded = 80% failure rate (above 30% threshold)
      ...Array.from({ length: 4 }, (_, i) => ({
        span_id: `fail-${i}`,
        provider: 'openai',
        operation: 'chat',
        terminal_status: 'failed',
        started_at: recent,
        finished_at: recent,
      })),
      {
        span_id: 'ok-1',
        provider: 'openai',
        operation: 'chat',
        terminal_status: 'succeeded',
        started_at: recent,
        finished_at: recent,
      },
      // This 'started' row should be ignored in the calculation
      {
        span_id: 'started-1',
        provider: 'openai',
        operation: 'chat',
        terminal_status: null,
        started_at: recent,
        finished_at: null,
      },
    ]

    const findings = await externalCallsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(rows) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('failure-rate'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('provider', 'openai')
  })

  it('reports started spans with no terminal row after one hour', async () => {
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString()
    const rows: SpanRow[] = [
      {
        span_id: 'stuck-1',
        provider: 'serper',
        operation: 'search',
        terminal_status: null,
        started_at: twoHoursAgo,
        finished_at: null,
      },
    ]

    const findings = await externalCallsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(rows) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('orphan-started'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('spanId', 'stuck-1')
  })
})
