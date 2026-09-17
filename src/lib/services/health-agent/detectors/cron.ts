/**
 * Cron detector — checks both HTTP-dispatched pg_cron jobs (via cron_http_log)
 * and SQL-only jobs (via read_cron_job_runs RPC).
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/cron-health.ts`
 * for HTTP jobs. SQL-only jobs are checked through the new RPC.
 */

import {
  CRON_HEALTH_LOOKBACK_HOURS,
  EXPECTED_CRON_JOBS,
  evaluateCronHealth,
  type CronHttpLogRow,
} from '../../../../../scripts/health-agent/cron-health'
import type { HealthFinding } from '../contracts'
import { stableFingerprint } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Expected SQL-only cron jobs — these write no cron_http_dispatch row, so
// they are invisible to the HTTP log. The read_cron_job_runs RPC reads
// cron.job + cron.job_run_details directly.
//
// keep in sync with the cron migration and EXPECTED_CRON_JOBS
// ---------------------------------------------------------------------------

export interface ExpectedSqlJob {
  jobName: string
  /** Max hours since last successful end_time before reporting stale. */
  maxAgeHours: number
}

export const EXPECTED_SQL_JOBS: readonly ExpectedSqlJob[] = [
  { jobName: 'purge-external-call-audit', maxAgeHours: 25 },
  { jobName: 'purge-admin-audit-log', maxAgeHours: 25 },
  { jobName: 'cron-http-retention', maxAgeHours: 25 },
  { jobName: 'cron-http-snapshot', maxAgeHours: 25 },
] as const

// ---------------------------------------------------------------------------
// Stale thresholds from the spec
// ---------------------------------------------------------------------------

/** HTTP job staleness: 25h daily, 192h weekly. */
export const HTTP_STALE_HOURS_DAILY = 25
export const HTTP_STALE_HOURS_WEEKLY = 192

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

type CronSupabase = {
  from: (table: string) => {
    select: (columns: string) => {
      gte: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          range: (
            from: number,
            to: number,
          ) => Promise<{ data: CronHttpLogRow[] | null; error: unknown }>
        }
      }
    }
  }
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{
    data:
      | {
          jobname: string
          schedule: string
          active: boolean
          last_end: string | null
          last_status: string | null
          failed_runs: number
        }[]
      | null
    error: unknown
  }>
}

export type CronDetectorDeps = {
  supabase: CronSupabase
}

export function cronDetector(deps: CronDetectorDeps): Detector {
  return {
    name: 'cron-health',
    source: 'cron',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      httpStaleHoursDaily: HTTP_STALE_HOURS_DAILY,
      httpStaleHoursWeekly: HTTP_STALE_HOURS_WEEKLY,
    },

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      const now = new Date(`${ctx.date}T04:50:00+08:00`)
      const lookbackMs = CRON_HEALTH_LOOKBACK_HOURS * 60 * 60 * 1000
      const sinceIso = new Date(now.getTime() - lookbackMs).toISOString()

      // Step 1: Read HTTP job log rows
      const PAGE_SIZE = 1_000
      const httpRows: CronHttpLogRow[] = []
      for (let page = 0; page < 10; page += 1) {
        const offset = page * PAGE_SIZE
        const { data, error } = await deps.supabase
          .from('cron_http_log')
          .select('request_id,job_name,status_code,timed_out,error_msg,created,logged_at')
          .gte('logged_at', sinceIso)
          .order('request_id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) throw error
        const rows = data ?? []
        httpRows.push(...rows)
        if (rows.length < PAGE_SIZE) break
      }

      // Step 2: Evaluate HTTP jobs
      const httpFindings = evaluateCronHealth(httpRows, now)

      // Step 3: Read SQL-only jobs via RPC
      const { data: sqlJobs, error: rpcError } = await deps.supabase.rpc(
        'read_cron_job_runs',
        { p_since: sinceIso },
      )

      if (rpcError) {
        return [
          ...httpFindings,
          {
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'rpc-failure', 'read_cron_job_runs'),
            title: 'Failed to read SQL-only cron job status',
            severity: 'high',
            evidence: { error: String(rpcError) },
            mergePolicy: 'human',
          },
        ]
      }

      const sqlFindings: HealthFinding[] = []
      const jobMap = new Map(
        (sqlJobs ?? []).map((j) => [j.jobname, j]),
      )

      for (const expected of EXPECTED_SQL_JOBS) {
        const job = jobMap.get(expected.jobName)

        if (!job) {
          // Job missing from cron.job entirely
          sqlFindings.push({
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'missing', expected.jobName),
            title: `Cron job missing from cron.job: ${expected.jobName}`,
            severity: 'high',
            evidence: { jobName: expected.jobName },
            mergePolicy: 'human',
          })
          continue
        }

        if (!job.active) {
          sqlFindings.push({
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'inactive', expected.jobName),
            title: `Cron job is inactive: ${expected.jobName}`,
            severity: 'high',
            evidence: { jobName: expected.jobName, active: false },
            mergePolicy: 'human',
          })
          continue
        }

        // Check staleness
        if (job.last_end) {
          const lastEndMs = new Date(job.last_end).getTime()
          const ageHours = (now.getTime() - lastEndMs) / (60 * 60 * 1000)
          if (ageHours > expected.maxAgeHours) {
            sqlFindings.push({
              source: 'cron',
              fingerprint: stableFingerprint('cron', 'stale', expected.jobName),
              title: `Cron SQL job has no successful run in ${expected.maxAgeHours}h: ${expected.jobName}`,
              severity: 'high',
              evidence: {
                jobName: expected.jobName,
                lastEnd: job.last_end,
                maxAgeHours: expected.maxAgeHours,
                ageHours: Number(ageHours.toFixed(2)),
              },
              mergePolicy: 'human',
            })
          }
        } else {
          // No run recorded at all
          sqlFindings.push({
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'stale', expected.jobName),
            title: `Cron SQL job has no successful run in ${expected.maxAgeHours}h: ${expected.jobName}`,
            severity: 'high',
            evidence: {
              jobName: expected.jobName,
              lastEnd: null,
              maxAgeHours: expected.maxAgeHours,
            },
            mergePolicy: 'human',
          })
        }

        // Check failures
        if (job.failed_runs > 0) {
          sqlFindings.push({
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'failed', expected.jobName),
            title: `Cron SQL job has failed runs: ${expected.jobName}`,
            severity: 'high',
            evidence: {
              jobName: expected.jobName,
              failedRuns: job.failed_runs,
              lastStatus: job.last_status,
            },
            mergePolicy: 'human',
          })
        }
      }

      // Also check if any expected HTTP job is missing from cron.job
      for (const expected of EXPECTED_CRON_JOBS) {
        const job = jobMap.get(expected.jobName)
        if (!job) {
          sqlFindings.push({
            source: 'cron',
            fingerprint: stableFingerprint('cron', 'missing', expected.jobName),
            title: `Cron job missing from cron.job: ${expected.jobName}`,
            severity: 'high',
            evidence: { jobName: expected.jobName },
            mergePolicy: 'human',
          })
        }
      }

      return [...httpFindings, ...sqlFindings]
    },
  }
}
