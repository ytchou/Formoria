/**
 * Curation jobs detector — monitors curation_jobs, curation_job_targets,
 * and curation_phase_outputs for dispatch failures, stale heartbeats,
 * high failure rates, and unpersisted phase outputs.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** A running job whose heartbeat is older than this is considered stale. */
const HEARTBEAT_STALE_MS = 60 * 60 * 1000 // 1 hour

/** Phase outputs not persisted after this window are flagged. */
const UNPERSISTED_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** Look back this far for recently completed jobs to check failure rates. */
const COMPLETED_LOOKBACK_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row shapes (minimal projections)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const curationJobsDetector: Detector = {
  name: 'curation-jobs',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'high',
  thresholds: {
    heartbeatStaleMs: HEARTBEAT_STALE_MS,
    unpersistedThresholdMs: UNPERSISTED_THRESHOLD_MS,
  },

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []
    const now = Date.now()

    // 1. Pending jobs with failed dispatch
    const pendingJobs = await pagedRead<JobRow>(supabase, 'curation_jobs', {
      orderBy: [{ column: 'id' }],
      select:
        'id, status, dispatch_status, dispatch_error, heartbeat_at, completed_at, created_at, succeeded_count, failed_count',
      filters: [
        { column: 'status', value: 'pending' },
        { column: 'dispatch_status', value: 'failed' },
      ],
    })

    for (const job of pendingJobs) {
      findings.push({
        source: 'pipeline',
        fingerprint: stableFingerprint(
          'pipeline',
          'dispatch-failed',
          job.id,
        ),
        title: `Curation job ${job.id} dispatch failed: ${job.dispatch_error ?? 'unknown'}`,
        severity: 'high',
        evidence: {
          jobId: job.id,
          dispatchError: job.dispatch_error ?? 'unknown',
          createdAt: job.created_at ?? 'unknown',
        },
        mergePolicy: 'human',
      })
    }

    // 2. Running jobs with stale heartbeat
    const runningJobs = await pagedRead<JobRow>(supabase, 'curation_jobs', {
      orderBy: [{ column: 'id' }],
      select:
        'id, status, dispatch_status, dispatch_error, heartbeat_at, completed_at, created_at, succeeded_count, failed_count',
      filters: [{ column: 'status', value: 'running' }],
    })

    for (const job of runningJobs) {
      if (!job.heartbeat_at) continue
      const heartbeatAge = now - new Date(job.heartbeat_at).getTime()
      if (heartbeatAge > HEARTBEAT_STALE_MS) {
        findings.push({
          source: 'pipeline',
          fingerprint: stableFingerprint(
            'pipeline',
            'stale-heartbeat',
            job.id,
          ),
          title: `Curation job ${job.id} has stale heartbeat (${Math.round(heartbeatAge / 60_000)} min)`,
          severity: 'high',
          evidence: {
            jobId: job.id,
            heartbeatAt: job.heartbeat_at,
            ageMinutes: Math.round(heartbeatAge / 60_000),
          },
          mergePolicy: 'human',
        })
      }
    }

    // 3. Recently completed jobs with high failure rate
    const completedCutoff = new Date(
      now - COMPLETED_LOOKBACK_MS,
    ).toISOString()
    const completedJobs = await pagedRead<JobRow>(supabase, 'curation_jobs', {
      orderBy: [{ column: 'id' }],
      select:
        'id, status, dispatch_status, dispatch_error, heartbeat_at, completed_at, created_at, succeeded_count, failed_count',
      filters: [{ column: 'status', value: 'completed' }],
    })

    for (const job of completedJobs) {
      if (
        job.completed_at &&
        job.completed_at >= completedCutoff &&
        job.failed_count > job.succeeded_count
      ) {
        findings.push({
          source: 'pipeline',
          fingerprint: stableFingerprint(
            'pipeline',
            'high-failure',
            job.id,
          ),
          title: `Curation job ${job.id} had more failures (${job.failed_count}) than successes (${job.succeeded_count})`,
          severity: 'medium',
          evidence: {
            jobId: job.id,
            succeededCount: job.succeeded_count,
            failedCount: job.failed_count,
            completedAt: job.completed_at,
          },
          mergePolicy: 'human',
        })
      }
    }

    // 4. Phase outputs never persisted after 24 hours
    const persistCutoff = new Date(
      now - UNPERSISTED_THRESHOLD_MS,
    ).toISOString()
    const phaseOutputs = await pagedRead<PhaseOutputRow>(
      supabase,
      'curation_phase_outputs',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, job_id, status, persisted_at, created_at',
        filters: [{ column: 'status', value: 'completed' }],
      },
    )

    for (const po of phaseOutputs) {
      if (po.persisted_at === null && po.created_at < persistCutoff) {
        findings.push({
          source: 'pipeline',
          fingerprint: stableFingerprint(
            'pipeline',
            'unpersisted',
            po.id,
          ),
          title: `Phase output ${po.id} (job ${po.job_id}) completed but never persisted`,
          severity: 'medium',
          evidence: {
            phaseOutputId: po.id,
            jobId: po.job_id,
            createdAt: po.created_at,
          },
          mergePolicy: 'human',
        })
      }
    }

    return findings
  },
}
