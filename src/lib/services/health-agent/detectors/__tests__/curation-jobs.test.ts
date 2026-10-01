import { afterEach, describe, expect, it, vi } from 'vitest'
import { curationJobsDetector } from '../curation-jobs'
import { stableFingerprint } from '../../contracts'
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
  trigger?: string
  run_after?: string
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
        lte: (_col: string, val: unknown) => {
          filtered = filtered.filter((r) => {
            const row = r as unknown as Record<string, unknown>
            return (row[_col] as string) <= (val as string)
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
        order: (col: string, opts?: { ascending: boolean }) => {
          const dir = opts?.ascending === false ? -1 : 1
          filtered.sort((a, b) => {
            const av = String((a as unknown as Record<string, unknown>)[col] ?? '')
            const bv = String((b as unknown as Record<string, unknown>)[col] ?? '')
            return av < bv ? -dir : av > bv ? dir : 0
          })
          return builder
        },
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

  describe('cron-missed', () => {
    const cronMissedFp = stableFingerprint('pipeline', 'cron-missed', 'curation-worker')

    function cronJob(id: string, ageMs: number): JobRow {
      const createdAt = new Date(Date.now() - ageMs).toISOString()
      return {
        id,
        status: 'completed',
        dispatch_status: 'dispatched',
        dispatch_error: null,
        heartbeat_at: null,
        completed_at: createdAt,
        created_at: createdAt,
        succeeded_count: 1,
        failed_count: 0,
        trigger: 'cron',
        run_after: createdAt,
      }
    }

    it('flags cron-missed when newest cron job is older than 7h', async () => {
      const jobs = [cronJob('cron-old', 9 * HOUR), cronJob('cron-older', 15 * HOUR)]

      const findings = await curationJobsDetector.run(
        ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
      )
      const finding = findings.find((f) => f.fingerprint === cronMissedFp)
      expect(finding).toBeDefined()
      expect(finding!.severity).toBe('high')
      expect(finding!.evidence).toHaveProperty('lastCronJobId', 'cron-old')
    })

    it('flags cron-missed when no cron job exists', async () => {
      const findings = await curationJobsDetector.run(
        ctx({ deps: { supabase: fakeSupabase([], []) } }),
      )
      expect(findings.some((f) => f.fingerprint === cronMissedFp)).toBe(true)
    })

    it('no cron-missed finding when a cron job is fresh', async () => {
      const jobs = [cronJob('cron-old', 13 * HOUR), cronJob('cron-new', 2 * HOUR)]

      const findings = await curationJobsDetector.run(
        ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
      )
      expect(findings.some((f) => f.fingerprint === cronMissedFp)).toBe(false)
    })
  })

  describe('staging', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('skips cron-missed and stranded-pending in staging, where the worker does not run', async () => {
      vi.stubEnv('FORMORIA_DEPLOYMENT_ENV', 'staging')
      const jobs: JobRow[] = [
        {
          id: 'p-stranded',
          status: 'pending',
          dispatch_status: 'dispatched',
          dispatch_error: null,
          heartbeat_at: null,
          completed_at: null,
          created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
          succeeded_count: 0,
          failed_count: 0,
          trigger: 'admin',
          run_after: new Date(Date.now() - 2 * HOUR).toISOString(),
        },
        {
          id: 'p-dispatch-failed',
          status: 'pending',
          dispatch_status: 'failed',
          dispatch_error: 'worker unreachable',
          heartbeat_at: null,
          completed_at: null,
          created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
          succeeded_count: 0,
          failed_count: 0,
          trigger: 'admin',
          run_after: new Date(Date.now() - 2 * HOUR).toISOString(),
        },
      ]

      const findings = await curationJobsDetector.run(
        ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
      )
      expect(findings.some((f) => f.fingerprint.includes('cron-missed'))).toBe(false)
      expect(findings.some((f) => f.fingerprint.includes('stranded-pending'))).toBe(false)
      // The other checks still run in staging.
      expect(findings.some((f) => f.fingerprint.includes('dispatch-failed'))).toBe(true)
    })
  })

  describe('stranded-pending', () => {
    function pendingJob(
      id: string,
      createdAgoMs: number,
      runAfterAgoMs: number,
      dispatchStatus = 'dispatched',
    ): JobRow {
      return {
        id,
        status: 'pending',
        dispatch_status: dispatchStatus,
        dispatch_error: null,
        heartbeat_at: null,
        completed_at: null,
        created_at: new Date(Date.now() - createdAgoMs).toISOString(),
        succeeded_count: 0,
        failed_count: 0,
        trigger: 'admin',
        run_after: new Date(Date.now() - runAfterAgoMs).toISOString(),
      }
    }

    const strandedFindings = (findings: Awaited<ReturnType<typeof curationJobsDetector.run>>) =>
      findings.filter((f) => f.fingerprint.includes('stranded-pending'))

    it('flags stranded-pending when a pending job waited >15 min and none is running', async () => {
      const jobs = [
        pendingJob('p-1', 30 * MINUTE, 30 * MINUTE),
        pendingJob('p-2', 60 * MINUTE, 20 * MINUTE),
        pendingJob('p-fresh', 5 * MINUTE, 5 * MINUTE),
      ]

      const findings = strandedFindings(
        await curationJobsDetector.run(ctx({ deps: { supabase: fakeSupabase(jobs, []) } })),
      )
      expect(findings.map((f) => f.fingerprint).sort()).toEqual(
        [
          stableFingerprint('pipeline', 'stranded-pending', 'p-1'),
          stableFingerprint('pipeline', 'stranded-pending', 'p-2'),
        ].sort(),
      )
      expect(findings[0]!.evidence).toHaveProperty('jobId')
    })

    it('no stranded-pending when a job is running', async () => {
      const jobs = [
        pendingJob('p-1', 30 * MINUTE, 30 * MINUTE),
        {
          ...pendingJob('r-1', 40 * MINUTE, 40 * MINUTE),
          status: 'running',
          heartbeat_at: new Date().toISOString(),
        },
      ]

      const findings = strandedFindings(
        await curationJobsDetector.run(ctx({ deps: { supabase: fakeSupabase(jobs, []) } })),
      )
      expect(findings).toHaveLength(0)
    })

    it('ignores pending jobs with run_after in the future', async () => {
      const jobs = [pendingJob('p-retry', 2 * HOUR, -30 * MINUTE)]

      const findings = strandedFindings(
        await curationJobsDetector.run(ctx({ deps: { supabase: fakeSupabase(jobs, []) } })),
      )
      expect(findings).toHaveLength(0)
    })

    it('does not double-report pending jobs whose dispatch already failed', async () => {
      const jobs = [pendingJob('p-failed', 2 * HOUR, 2 * HOUR, 'failed')]

      const findings = await curationJobsDetector.run(
        ctx({ deps: { supabase: fakeSupabase(jobs, []) } }),
      )
      expect(strandedFindings(findings)).toHaveLength(0)
      expect(findings.some((f) => f.fingerprint.includes('dispatch-failed'))).toBe(true)
    })
  })
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
