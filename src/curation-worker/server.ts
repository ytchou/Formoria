/**
 * Curation worker entry point — a Railway cron one-shot.
 *
 * Railway starts this process on the cron schedule (0 4,10,16,22 * * * UTC,
 * a dashboard setting documented in railway/curation-worker.json) and on a
 * manual "Run now" requested by `dispatchCurationJob`. Each execution:
 *
 *   1. `bootWorker` — env, target assertion, then the service imports.
 *   2. `runScheduledCuration` — recovers stale jobs, queues the scheduled slot,
 *      and drains the single-runner queue until it is empty or the soft
 *      deadline passes.
 *   3. Flushes Langfuse and Sentry, then `process.exit`.
 *
 * Railway never kills a hung cron execution and skips every later slot while
 * one is Active, so a hard-cap timer cancels the in-flight job and exits 1.
 */

import { bootWorker, logWorkerBuildInfo } from "@/worker-boot";
import {
  assertDatabaseTarget,
  type WorkerTarget,
} from "@/lib/supabase/project-target";
import { isStagingEnvironment } from "@/lib/deployment-environment";

// ---------------------------------------------------------------------------
// Dynamic imports — populated after bootWorker
// ---------------------------------------------------------------------------

let runScheduledCuration: Awaited<
  typeof import("@/lib/services/curation-worker")
>["runScheduledCuration"];
let cancelCurationJob: Awaited<
  typeof import("@/lib/services/curation-jobs")
>["cancelCurationJob"];
let sanitizeJobError: Awaited<
  typeof import("@/lib/services/job-runner")
>["sanitizeJobError"];
let reportWorkerFailure: Awaited<
  typeof import("@/lib/services/job-alerts")
>["reportWorkerFailure"];
let runWithAuditContext: Awaited<
  typeof import("@/lib/audit/context")
>["runWithAuditContext"];
let flushLangfuse: Awaited<
  typeof import("@/lib/langfuse/client")
>["flushLangfuse"];
let flushAlerts: Awaited<
  typeof import("@/lib/adapters/alerting/sentry")
>["flushAlerts"];

// Populated by assertTarget inside bootWorker, after env is loaded.
let target: WorkerTarget;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

await bootWorker({
  agent: "curation",
  // Runs before the service modules below are imported, so a cross-wired
  // worker dies at boot instead of claiming a job. The environment
  // declaration is fail-open (unset means production), so it is never
  // trusted on its own — the attached database must corroborate it.
  // See src/lib/supabase/project-target.ts.
  assertTarget: () => {
    target = assertDatabaseTarget(
      isStagingEnvironment() ? "staging" : "production",
    );
  },
  async loadServices() {
    ({ runScheduledCuration } = await import(
      "@/lib/services/curation-worker"
    ));
    ({ cancelCurationJob } = await import("@/lib/services/curation-jobs"));
    ({ sanitizeJobError } = await import("@/lib/services/job-runner"));
    ({ reportWorkerFailure } = await import("@/lib/services/job-alerts"));
    ({ runWithAuditContext } = await import("@/lib/audit/context"));
    ({ flushLangfuse } = await import("@/lib/langfuse/client"));
    ({ flushAlerts } = await import("@/lib/adapters/alerting/sentry"));
  },
  async reportFailure(context, error) {
    if (reportWorkerFailure) {
      await reportWorkerFailure(context, error);
    }
  },
  sanitizeError: (e) =>
    sanitizeJobError ? sanitizeJobError(e) : String(e),
});

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

// Stop claiming new jobs after 4h so a run ends well before the next 6h slot.
// Ceiling: a job claimed just before 4h may itself run long (max observed
// 223 min, 2026-10). Upgrade path: make this env-configurable if a legitimate
// queue ever needs longer than one slot to drain.
const SOFT_DEADLINE_MS = 4 * 60 * 60_000;

// 5h45m keeps a hung run from skipping the next 6h slot; raise both constants
// if a legitimate job ever exceeds ~4h (max observed 223 min, 2026-10).
const HARD_CAP_MS = 5 * 60 * 60_000 + 45 * 60_000;

const WALL_CLOCK_CAP_REASON = "Worker wall-clock cap reached";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let currentJobId: string | null = null;
let hardCapRun: Promise<never> | null = null;

async function flushAndExit(code: number): Promise<never> {
  try {
    await flushLangfuse();
  } catch {
    /* flush failure must not mask exit */
  }
  await flushAlerts(); // never throws
  process.exit(code);
}

async function onHardCap(): Promise<never> {
  console.error(
    `[curation-worker] wall-clock cap reached after ${HARD_CAP_MS / 60_000} min — cancelling job ${currentJobId ?? "(none)"} and exiting`,
  );
  if (currentJobId) {
    try {
      await cancelCurationJob(currentJobId, WALL_CLOCK_CAP_REASON);
    } catch (error) {
      console.error("[curation-worker:hard-cap]", sanitizeJobError(error));
    }
  }
  try {
    await reportWorkerFailure(
      "wall-clock-cap",
      new Error(`${WALL_CLOCK_CAP_REASON} (${HARD_CAP_MS / 60_000} min)`),
    );
  } catch {
    /* reporting must not block the exit */
  }
  return flushAndExit(1);
}

async function main(): Promise<never> {
  logWorkerBuildInfo("curation-worker");
  // Which database this worker will actually write to, verified at boot rather
  // than inferred from the environment name.
  console.log(
    `[curation-worker] target env=${target.deploymentEnvironment} project=${target.projectRef}`,
  );

  const startedAt = Date.now();
  setTimeout(() => {
    hardCapRun = onHardCap();
  }, HARD_CAP_MS).unref();

  let exitCode = 0;
  try {
    const result = await runWithAuditContext({}, () =>
      runScheduledCuration(new Date(startedAt), {
        softDeadlineAt: startedAt + SOFT_DEADLINE_MS,
        onJobClaimed: (job) => {
          currentJobId = job.id;
        },
      }),
    );
    const scheduled = result.scheduledJob
      ? `queued ${result.scheduledJob.id} for ${result.scheduledJob.scheduled_for}; `
      : "";
    console.log(
      `[curation-cron] ${scheduled}processed ${result.processed} ${result.processed === 1 ? "job" : "jobs"} deadlineHit=${result.deadlineHit}`,
    );
  } catch (error) {
    console.error("[curation-cron]", sanitizeJobError(error));
    exitCode = 1;
    try {
      await reportWorkerFailure("cron", error);
    } catch {
      /* reporting must not block the exit */
    }
  } finally {
    // The hard cap owns the exit once it fires: it must finish cancelling
    // and reporting before the process goes away.
    if (hardCapRun) await hardCapRun;
  }
  return flushAndExit(exitCode);
}

void main();
