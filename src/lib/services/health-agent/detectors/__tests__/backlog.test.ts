import { describe, expect, it } from 'vitest'
import { backlogDetector } from '../backlog'
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

type SubmissionRow = {
  id: string
  status: string
  submitted_at: string | null
}

type ModerationRow = {
  id: string
  status: string
  created_at: string
}

type CorrectionRow = {
  id: string
  status: string
  created_at: string
}

function fakeSupabase(
  submissions: SubmissionRow[],
  flags: ModerationRow[],
  corrections: CorrectionRow[],
) {
  return {
    from(table: string) {
      let data: unknown[]
      if (table === 'brand_submissions') data = submissions
      else if (table === 'moderation_flags') data = flags
      else if (table === 'brand_field_corrections') data = corrections
      else throw new Error(`Unexpected table: ${table}`)

      let filtered = [...data]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as Record<string, unknown>)[_col] === val,
          )
          return builder
        },
        lt: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as Record<string, unknown>)[_col] as string) <
              (val as string),
          )
          return builder
        },
        gte: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) =>
              ((r as Record<string, unknown>)[_col] as string) >=
              (val as string),
          )
          return builder
        },
        is: (_col: string, val: unknown) => {
          filtered = filtered.filter(
            (r) => (r as Record<string, unknown>)[_col] === val,
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

describe('backlog detector', () => {
  it('reports submissions, moderation flags and corrections older than their thresholds', async () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const fifteenDaysAgo = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString()

    const submissions: SubmissionRow[] = [
      { id: 'sub-1', status: 'pending', submitted_at: eightDaysAgo },
    ]
    const flags: ModerationRow[] = [
      { id: 'flag-1', status: 'pending', created_at: eightDaysAgo },
    ]
    const corrections: CorrectionRow[] = [
      { id: 'corr-1', status: 'pending', created_at: fifteenDaysAgo },
    ]

    const findings = await backlogDetector.run(
      ctx({
        deps: { supabase: fakeSupabase(submissions, flags, corrections) },
      }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(3)

    const subFinding = findings.find((f) =>
      f.fingerprint.includes('submissions'),
    )
    expect(subFinding).toBeDefined()
    expect(subFinding!.evidence).toHaveProperty('count', 1)

    const flagFinding = findings.find((f) =>
      f.fingerprint.includes('moderation'),
    )
    expect(flagFinding).toBeDefined()
    expect(flagFinding!.evidence).toHaveProperty('count', 1)

    const corrFinding = findings.find((f) =>
      f.fingerprint.includes('corrections'),
    )
    expect(corrFinding).toBeDefined()
    expect(corrFinding!.evidence).toHaveProperty('count', 1)
  })
})
