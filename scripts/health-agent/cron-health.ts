import {
  stableFingerprint,
  type HealthFinding,
  type JsonValue,
} from "./contracts";
import { MIT_REGISTRY_SYNC_MAX_AGE_HOURS } from "@/lib/services/mit-registry";

export interface ExpectedCronJob {
  /** `cron.job.jobname` of a scheduled pg_cron HTTP dispatch. */
  jobName: string;
  /**
   * How old the newest *successful* dispatch may be before the job counts as
   * stale. Sized as one interval plus slack for missed ticks, so a single late
   * run does not page anyone.
   */
  maxAgeHours: number;
}

/**
 * The pg_cron HTTP jobs that are expected to exist and keep succeeding.
 * A job missing from the log entirely is a stale finding — that is what makes
 * "silently unscheduled" detectable. Keep this in sync with the cron migration.
 *
 * KNOWN BLIND SPOT (DEV-1558, audited 2026-08-22): production runs seven
 * pg_cron jobs and this detector can see only these three. The other four —
 * `purge-external-call-audit`, `purge-admin-audit-log`, `cron-http-retention`,
 * `cron-http-snapshot` — are pure SQL. They never call `net.http_post`, so they
 * write no `cron_http_dispatch` row and produce no `cron_http_log` row, and a
 * log-based detector is structurally unable to observe them. Adding their names
 * here would make them permanently stale, not monitored.
 *
 * Closing the gap needs a different source — `cron.job_run_details` — which
 * reports the scheduler's own outcome and is the right signal for a job whose
 * work is a single SQL statement. Deliberately not done here: this detector
 * reads through the health agent's existing log query and has no database
 * client of its own.
 */
export const EXPECTED_CRON_JOBS: readonly ExpectedCronJob[] = [
  // The daily job runs 03:15 Taipei and is read by the 04:50 health agent, so a
  // punctual dispatch is ~2h old at check time. 25h is sized to fire on the
  // FIRST missed day (age ~26h at the next check) rather than tolerating one —
  // the name still says "6h" because renaming a pg_cron job means recreating
  // it. See
  // supabase/migrations/20260811120000_standardize_cron_maintenance_window.sql.
  //
  // `claim-proof-cleanup-hourly` was unscheduled with the claim flow (DEV-1570);
  // its HTTP endpoint is gone, so the job would have 404'd on every run.
  {
    jobName: "sync-mit-registry-weekly",
    maxAgeHours: MIT_REGISTRY_SYNC_MAX_AGE_HOURS,
  }, // weekly + 24h grace
  { jobName: "classifier-image-retention-6h", maxAgeHours: 25 }, // daily 03:15 Taipei
] as const;

/**
 * The read window must be wider than the slowest job's staleness budget, or
 * that job would be permanently "stale" simply because its successes fall
 * outside the query. Derived, never hard-coded.
 */
const CRON_HEALTH_LOOKBACK_MARGIN_HOURS = 24;
export const CRON_HEALTH_LOOKBACK_HOURS =
  Math.max(...EXPECTED_CRON_JOBS.map((job) => job.maxAgeHours)) +
  CRON_HEALTH_LOOKBACK_MARGIN_HOURS;

export interface CronHttpLogRow {
  request_id: number;
  job_name: string;
  status_code: number | null;
  timed_out: boolean;
  error_msg: string | null;
  created: string | null;
  logged_at: string;
}

type CronSignal = "failed" | "stale";

/**
 * Success is defined positively: a 2xx that did not time out. Everything else —
 * non-2xx, timeout, and a pg_net transport error (`status_code NULL` with an
 * `error_msg` such as "Could not resolve host") — is a failure. Enumerating
 * failure shapes is what previously let transport errors pass as healthy.
 */
function isSuccess(row: CronHttpLogRow): boolean {
  return (
    row.status_code !== null &&
    row.status_code >= 200 &&
    row.status_code <= 299 &&
    !row.timed_out
  );
}

/** Dispatch time when pg_net recorded one, else the snapshot time. */
function rowTimeMs(row: CronHttpLogRow): number {
  const parsed = Date.parse(row.created ?? row.logged_at);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function finding(
  signal: CronSignal,
  job: ExpectedCronJob,
  evidence: Record<string, JsonValue>,
): HealthFinding {
  return {
    evidence: {
      jobName: job.jobName,
      lookbackHours: CRON_HEALTH_LOOKBACK_HOURS,
      ...evidence,
    },
    fingerprint: stableFingerprint("cron", signal, job.jobName),
    mergePolicy: "human",
    // Both signals mean the job is not doing its work; severity follows the
    // signal, so callers never pass it in.
    severity: "high",
    source: "cron",
    title:
      signal === "failed"
        ? `Cron HTTP job is failing: ${job.jobName}`
        : `Cron HTTP job has no successful run in ${job.maxAgeHours}h: ${job.jobName}`,
  };
}

function failureEvidence(
  rows: readonly CronHttpLogRow[],
): Record<string, JsonValue> {
  const statusCodes = [
    ...new Set(
      rows
        .map((row) => row.status_code)
        .filter((code): code is number => code !== null),
    ),
  ].sort((left, right) => left - right);
  const sampleErrorMsg =
    rows.find((row) => row.error_msg !== null)?.error_msg ?? null;
  return {
    failureCount: rows.length,
    sampleErrorMsg,
    statusCodes,
    timedOutCount: rows.filter((row) => row.timed_out).length,
    transportFailureCount: rows.filter((row) => row.status_code === null)
      .length,
  };
}

/**
 * `rows` may legitimately be empty — that is "nothing dispatched", which
 * surfaces as one stale finding per expected job, not as an error.
 */
export function evaluateCronHealth(
  rows: readonly CronHttpLogRow[],
  now: Date = new Date(),
): HealthFinding[] {
  const nowMs = now.getTime();
  const findings: HealthFinding[] = [];

  for (const job of EXPECTED_CRON_JOBS) {
    const jobRows = rows.filter((row) => row.job_name === job.jobName);
    const failures = jobRows.filter((row) => !isSuccess(row));
    if (failures.length > 0) {
      findings.push(finding("failed", job, failureEvidence(failures)));
    }

    const successTimes = jobRows
      .filter(isSuccess)
      .map(rowTimeMs)
      .filter((value) => Number.isFinite(value));
    const lastSuccessMs =
      successTimes.length > 0 ? Math.max(...successTimes) : null;
    const maxAgeMs = job.maxAgeHours * 60 * 60 * 1000;
    if (lastSuccessMs === null || nowMs - lastSuccessMs > maxAgeMs) {
      findings.push(
        finding("stale", job, {
          lastSuccessAt:
            lastSuccessMs === null
              ? null
              : new Date(lastSuccessMs).toISOString(),
          maxAgeHours: job.maxAgeHours,
          successCount: successTimes.length,
        }),
      );
    }
  }

  return findings;
}
