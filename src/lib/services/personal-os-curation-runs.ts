import {
  listCurationJobs,
  type CurationJob,
} from "@/lib/services/curation-jobs";
import { routes } from "@/lib/routes";

const PERSONAL_OS_CURATION_RUNS_SCHEMA_VERSION = 1 as const;
export const PERSONAL_OS_CURATION_RUNS_DEFAULT_LIMIT = 50;
export const PERSONAL_OS_CURATION_RUNS_MAX_LIMIT = 50;

export type PersonalOsCurationRunsWindow = {
  start: string;
  end: string;
};

type PersonalOsCurationRun = {
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
  window: PersonalOsCurationRunsWindow | null;
  runs: PersonalOsCurationRun[];
};

export function normalizePersonalOsCurationRunsWindow(
  start: string | null,
  end: string | null,
): PersonalOsCurationRunsWindow | undefined {
  if (start === null && end === null) return undefined;
  if (start === null || end === null) {
    throw new Error("start and end must be provided together");
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("start and end must be valid timestamps");
  }
  if (startDate >= endDate) throw new Error("start must be before end");
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

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
    sourcePath: routes.admin.job(job.id),
  };
}

/**
 * Versioned Personal OS projection. Keep this boundary deliberately narrower
 * than CurationJob: params, worker leases, and provider payloads never leave
 * Formoria's service layer.
 */
export async function getPersonalOsCurationRuns(
  requestedLimit?: number,
  window?: PersonalOsCurationRunsWindow,
): Promise<PersonalOsCurationRunsSnapshot> {
  const limit = window
    ? PERSONAL_OS_CURATION_RUNS_MAX_LIMIT
    : normalizePersonalOsCurationRunsLimit(requestedLimit);
  const { jobs, total } = await listCurationJobs({ limit, window });
  if (window && total > limit) {
    throw new Error("The requested curation run window exceeds the safe limit");
  }
  return {
    schemaVersion: PERSONAL_OS_CURATION_RUNS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    window: window ?? null,
    runs: jobs.map(toPersonalOsCurationRun),
  };
}
