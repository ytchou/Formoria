import { describe, expect, it } from 'vitest'
import { emailDetector } from '../email'
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

type AuditRow = {
  span_id: string
  provider: string
  terminal_status: string | null
  started_at: string
}

function fakeSupabase(rows: AuditRow[]) {
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
          Promise.resolve({
            data: filtered.slice(_from, _to + 1),
            error: null,
          }),
      }
      return builder
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('email detector', () => {
  it('reports failed resend sends in 24 hours', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows: AuditRow[] = [
      {
        span_id: 'email-1',
        provider: 'resend',
        terminal_status: 'failed',
        started_at: recent,
      },
      {
        span_id: 'email-2',
        provider: 'resend',
        terminal_status: 'failed',
        started_at: recent,
      },
      {
        span_id: 'email-3',
        provider: 'resend',
        terminal_status: 'succeeded',
        started_at: recent,
      },
    ]

    const findings = await emailDetector.run(
      ctx({ deps: { supabase: fakeSupabase(rows) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('resend-failures'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('failedCount', 2)
  })
})
