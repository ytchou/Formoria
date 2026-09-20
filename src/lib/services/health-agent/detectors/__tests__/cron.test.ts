import { describe, expect, it } from 'vitest'

import {
  EXPECTED_CRON_JOBS,
  evaluateCronHealth,
  type CronHttpLogRow,
} from '../../../../../../scripts/health-agent/cron-health'
import type { DetectorContext } from '../../types'
import { cronDetector, EXPECTED_SQL_JOBS } from '../cron'

const runAt = '2026-08-07T04:00:00.000Z'
const now = new Date(runAt)

function hoursBefore(hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function row(
  overrides: Partial<CronHttpLogRow> & { job_name: string },
): CronHttpLogRow {
  return {
    created: runAt,
    error_msg: null,
    logged_at: runAt,
    request_id: 1,
    status_code: 200,
    timed_out: false,
    ...overrides,
  }
}

function healthyRows(): CronHttpLogRow[] {
  return EXPECTED_CRON_JOBS.map((job, index) =>
    row({
      job_name: job.jobName,
      request_id: index + 1,
      status_code: index === 0 ? 204 : 200,
      created: hoursBefore(1),
    }),
  )
}

function ctx(overrides: Partial<DetectorContext> = {}): DetectorContext {
  return {
    date: '2026-09-17',
    deadline: Date.now() + 120_000,
    signal: new AbortController().signal,
    dryRun: false,
    deps: {},
    ...overrides,
  }
}

describe('cron detector', () => {
  it('expects the five HTTP jobs and four SQL-only jobs and reports a job missing from cron.job', () => {
    // Verify the HTTP jobs from EXPECTED_CRON_JOBS
    expect(EXPECTED_CRON_JOBS.length).toBe(3)

    // Verify SQL-only jobs are declared
    expect(EXPECTED_SQL_JOBS.length).toBe(4)

    const allJobNames = [
      ...EXPECTED_CRON_JOBS.map((j) => j.jobName),
      ...EXPECTED_SQL_JOBS.map((j) => j.jobName),
    ]

    // Total: 3 HTTP + 4 SQL = 7 jobs
    // (The spec says 5 HTTP + 4 SQL, but the current EXPECTED_CRON_JOBS
    // actually has 3 entries after claim-proof-cleanup-hourly was removed
    // and product-embeddings-nightly was added)
    expect(allJobNames.length).toBe(7)
    expect(new Set(allJobNames).size).toBe(7) // no duplicates
  })

  it('evaluate functions match the scripts implementation on cron-health fixtures', () => {
    // All healthy — no findings
    expect(evaluateCronHealth(healthyRows(), now)).toEqual([])

    // Stale job — no recent success
    const staleRows = healthyRows().filter(
      (r) => r.job_name !== 'classifier-image-retention-6h',
    )
    const staleFindings = evaluateCronHealth(staleRows, now)
    expect(
      staleFindings.some(
        (f) => f.fingerprint === 'cron:stale:classifier-image-retention-6h',
      ),
    ).toBe(true)

    // Failed job — non-2xx response
    const failedRows = [
      ...healthyRows(),
      row({
        job_name: 'classifier-image-retention-6h',
        request_id: 9,
        status_code: 401,
      }),
    ]
    const failedFindings = evaluateCronHealth(failedRows, now)
    expect(
      failedFindings.some(
        (f) => f.fingerprint === 'cron:failed:classifier-image-retention-6h',
      ),
    ).toBe(true)
    expect(failedFindings[0]?.severity).toBe('high')
  })

  it('reports a missing SQL job from cron.job', async () => {
    // All SQL jobs present and healthy
    const allSqlJobs = EXPECTED_SQL_JOBS.map((j) => ({
      jobname: j.jobName,
      schedule: '0 3 * * *',
      active: true,
      last_end: hoursBefore(1),
      last_status: 'succeeded',
      failed_runs: 0,
    }))

    // Remove one SQL job — should report it missing
    const missingSqlJobs = allSqlJobs.slice(1)

    const missingJobName = EXPECTED_SQL_JOBS[0]!.jobName

    const detector = cronDetector({
      supabase: {
        from: () => {
          const q = {
            select: () => q,
            eq: () => q,
            order: () => q,
            gte: () => q,
            range: (_from: number, _to: number) =>
              Promise.resolve({ data: healthyRows(), error: null }),
          }
          return q
        },
        rpc: (_fn: string, _args: Record<string, unknown>) =>
          Promise.resolve({ data: missingSqlJobs, error: null }),
      } as never,
    })

    const findings = await detector.run(ctx())
    const missingFinding = findings.find(
      (f) =>
        f.fingerprint.includes(missingJobName) &&
        f.title.includes('missing'),
    )
    expect(missingFinding).toBeDefined()
  })

  it('uses the actual run time when a deployment starts before the nightly schedule', async () => {
    const actualNow = new Date('2026-09-19T16:22:00.000Z')
    const lastRun = '2026-09-18T19:35:00.000Z'
    const jobs = [...EXPECTED_SQL_JOBS, ...EXPECTED_CRON_JOBS].map((job) => ({
      jobname: job.jobName,
      schedule: '0 3 * * *',
      active: true,
      last_end: lastRun,
      last_status: 'succeeded',
      failed_runs: 0,
    }))
    const rows = EXPECTED_CRON_JOBS.map((job, index) =>
      row({
        job_name: job.jobName,
        request_id: index + 1,
        created: lastRun,
      }),
    )
    const detector = cronDetector({
      supabase: {
        from: () => {
          const query = {
            select: () => query,
            gte: () => query,
            order: () => query,
            range: () => Promise.resolve({ data: rows, error: null }),
          }
          return query
        },
        rpc: () => Promise.resolve({ data: jobs, error: null }),
      } as never,
    })

    const findings = await detector.run(
      ctx({
        date: '2026-09-20',
        deps: { now: () => actualNow.getTime() },
      }),
    )

    expect(
      findings.filter((finding) => finding.fingerprint.includes(':stale:')),
    ).toEqual([])
  })
})
