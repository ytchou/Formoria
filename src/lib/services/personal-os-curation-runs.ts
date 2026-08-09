import { listCurationJobs, type CurationJob } from "@/lib/services/curation-jobs";

const PERSONAL_OS_CURATION_RUNS_SCHEMA_VERSION = 1 as const;
export const PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT = 50;
export const PERSONAL_OS_CURATION_RUNS_MAX_LIMIT = 50;

export type PersonalOsCurationRun = {
  id: string;
  runner: "curation-worker";
  source: "formoria";
  status: CurationJob["status"];
  trigger: CurationJob["trigger"];
  startedAt: string | null;
  completedAt: string | null;
  outcome: {
    total: number;
    succeeded: number;
    skipped: number;
    failed: number;
    cancelled: number;
  };
  sourcePath: string;
};

export type PersonalOsCurationRunsSnapshot = {
  schemaVersion: typeof PERSONAL_OS_CURATION_RUNS_SCHEMA_VERSION;
  generatedAt: string;
  runs: PersonalOsCurationRun[];
};

export function normalizePersonalOsCurationRunsLimit(value?: number): number {
  if (!Number.isFinite(value)) return PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT;
  return Math.min(
    Math.max(Math.floor(value ?? PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT), 1),
    PERSONAL_OS_CURATION_RUNS_MAX_LIMIT,
  );
}
function toPersonalOsCurationRun(job: CurationJob): PersonalOsCurationRun {
  return {
    id: job.id,
    runner: "curation-worker",
    source: "formoria",
    status: job.status,
    trigger: job.trigger,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    outcome: {
      total: job.target_total,
      succeeded: job.succeeded_count,
      skipped: job.skipped_count,
      failed: job.failed_count,
      cancelled: job.cancelled_count ?? 0,
    },
    sourcePath: `/admin/jobs/${job.id}`,
  };
}

/**
 * Versioned Personal OS projection. Keep this boundary deliberately narrower
 * than CurationJob: params, worker leases, and provider payloads never leave
 * Formoria's service layer.
 */
export async function getPersonalOsCurationRuns(
  requestedLimit?: number,
): Promise<PersonalOsCurationRunsSnapshot> {
  const limit = normalizePersonalOsCurationRunsLimit(requestedLimit);
  const { jobs } = await listCurationJobs({ limit });
  return {
    schemaVersion: PERSONAL_OS_CURATION_RUNS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runs: jobs.map(toPersonalOsCurationRun),
  };
}
