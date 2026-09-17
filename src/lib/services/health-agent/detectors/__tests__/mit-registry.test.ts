import { describe, expect, it } from 'vitest'
import { mitRegistryDetector } from '../mit-registry'
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
  operation: string | null
  terminal_status: string | null
  started_at: string
  summary: Record<string, unknown> | null
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
        gte: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as unknown as Record<string, unknown>)[_col] as string) >=
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
        limit: () => builder,
      }
      return builder
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mit-registry detector', () => {
  it('reports a sync that wrote zero rows', async () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const rows: AuditRow[] = [
      {
        span_id: 'sync-1',
        provider: 'mit-registry',
        operation: 'sync_registry',
        terminal_status: 'succeeded',
        started_at: recent,
        summary: { upsertedCount: 0 },
      },
    ]

    const findings = await mitRegistryDetector.run(
      ctx({ deps: { supabase: fakeSupabase(rows) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('zero-row-sync'))
    expect(finding).toBeDefined()
  })
})
