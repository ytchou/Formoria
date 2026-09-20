import { describe, expect, it } from 'vitest'
import { curationJobsDetector } from '../curation-jobs'
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

type JobRow = {
  id: string
  status: string
  dispatch_status: string
  dispatch_error: string | null
  heartbeat_at: string | null
  completed_at: string | null
  created_at: string | null
  succeeded_count: number
  failed_count: number
}

type PhaseOutputRow = {
  id: string
  job_id: string
  status: string
  persisted_at: string | null
  created_at: string
}

function fakeSupabase(jobs: JobRow[], phaseOutputs: PhaseOutputRow[]) {
  return {
    from(table: string) {
      const rows = table === 'curation_jobs' ? jobs : phaseOutputs
      let filtered = [...rows]
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_col: string, val: unknown) => {
          if (table === 'curation_jobs') {
            // For jobs we filter by status/dispatch_status in the detector
            filtered = filtered.filter((r) => {
              const row = r as unknown as Record<string, unknown>
              return row[_col] === val
            })
          } else {
            filtered = filtered.filter((r) => {
              const row = r as unknown as Record<string, unknown>
              return row[_col] === val
            })
          }
          return builder
        },
        neq: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return row[_col] !== val
          })
          return builder
        },
        is: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return row[_col] === val
          })
          return builder
        },
        lt: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return (row[_col] as string) < (val as string)
          })
          return builder
        },
        gte: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return (row[_col] as string) >= (val as string)
          })
          return builder
        },
        gt: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return (row[_col] as string) > (val as string)
          })
          return builder
        },
        order: () => builder,
        range: (_from: number, _to: number) =>
          Promise.resolve({ data: filtered.slice(_from, _to + 1), error: null }),
        limit: () => builder,
      }
      return builder
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('curation-jobs detector', () => {
  it('reports pending jobs whose dispatch failed', async () => {
    const jobs: JobRow[] = [
      {
        id: 'job-1',
        status: 'pending',
        dispatch_status: 'failed',
        dispatch_error: 'worker unreachable',
        heartbeat_at: null,
        completed_at: null,
        created_at: '2026-09-16T10:00:00Z',
        succeeded_count: 0,
        failed_count: 0,
      },
    ]

    const findings = await curationJobsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('dispatch-failed'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('jobId', 'job-1')
  })

  it('reports running jobs with a heartbeat older than the threshold', async () => {
    const staleHeartbeat = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString() // 2 hours ago
    const jobs: JobRow[] = [
      {
        id: 'job-2',
        status: 'running',
        dispatch_status: 'dispatched',
        dispatch_error: null,
        heartbeat_at: staleHeartbeat,
        completed_at: null,
        created_at: '2026-09-16T10:00:00Z',
        succeeded_count: 0,
        failed_count: 0,
      },
    ]

    const findings = await curationJobsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('stale-heartbeat'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('jobId', 'job-2')
  })

  it('reports completed jobs where failed targets exceed succeeded', async () => {
    const jobs: JobRow[] = [
      {
        id: 'job-3',
        status: 'completed',
        dispatch_status: 'dispatched',
        dispatch_error: null,
        heartbeat_at: null,
        completed_at: new Date(Date.now() - 60_000).toISOString(),
        created_at: '2026-09-16T10:00:00Z',
        succeeded_count: 2,
        failed_count: 5,
      },
    ]

    const findings = await curationJobsDetector.run(
      ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('high-failure'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('jobId', 'job-3')
  })

  it('reports phase outputs never persisted after 24 hours', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const phaseOutputs: PhaseOutputRow[] = [
      {
        id: 'po-1',
        job_id: 'job-4',
        status: 'completed',
        persisted_at: null,
        created_at: oldDate,
      },
    ]

    const findings = await curationJobsDetector.run(
      ctx({ deps: { supabase: fakeSupabase([], phaseOutputs) } }),
    )
    expect(findings.length).toBeGreaterThanOrEqual(1)
    const finding = findings.find((f) => f.fingerprint.includes('unpersisted'))
    expect(finding).toBeDefined()
    expect(finding!.evidence).toHaveProperty('phaseOutputId', 'po-1')
  })
})
