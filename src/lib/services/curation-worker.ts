import { randomUUID } from "node:crypto";
import {
  claimNextCurationJob,
  enqueueScheduledSubmissionJob,
  ensureAutomaticRetries,
  recoverStaleJobs,
  type CurationJob,
} from "@/lib/services/curation-jobs";
import type { EnrichmentSummary } from "@/lib/services/enrichment-logger";
import { runJob } from "@/lib/services/job-runner";
import { auditedCall, runWithAuditContext } from "@/lib/audit";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const SCHEDULE_INTERVAL_HOURS = 6;

export type ScheduledCurationRun = {
  processed: number;
  scheduledJob: CurationJob | null;
  /** True when the run stopped claiming because the soft deadline passed. */
  deadlineHit: boolean;
};

/** Injectable seams, defaulting to the real services (see ops-agent ExecuteDeps). */
export type CurationWorkerDeps = {
  recoverStaleJobs: () => Promise<unknown>;
  ensureAutomaticRetries: () => Promise<unknown>;
  enqueueScheduledSubmissionJob: (
    scheduledFor: Date,
  ) => Promise<CurationJob | null>;
  claimNextCurationJob: (workerToken: string) => Promise<CurationJob | null>;
  runJob: (job: CurationJob, workerToken: string) => Promise<EnrichmentSummary>;
};

const defaultDeps: CurationWorkerDeps = {
  recoverStaleJobs,
  ensureAutomaticRetries,
  enqueueScheduledSubmissionJob,
  claimNextCurationJob,
  runJob,
};

type ScheduledCurationOptions = {
  /** Epoch ms after which no new job is claimed. The in-flight job is never raced. */
  softDeadlineAt: number;
  /** Called right after each successful claim, before the job runs. */
  onJobClaimed: (job: CurationJob) => void;
  deps?: CurationWorkerDeps;
};

export async function runScheduledCuration(
  now: Date,
  options: ScheduledCurationOptions,
): Promise<ScheduledCurationRun> {
  const deps = options.deps ?? defaultDeps;
  return auditedCall(
    { provider: "curation", operation: "runScheduledCuration", kind: "service" },
    async () => {
      await deps.recoverStaleJobs();
      await deps.ensureAutomaticRetries();

      const scheduledJob = await deps.enqueueScheduledSubmissionJob(
        getTaipeiScheduleSlot(now),
      );
      let processed = 0;

      while (true) {
        // Checked before every claim, never around `runJob`: a running job is
        // allowed to finish; the entry's hard cap handles a hung one.
        if (Date.now() >= options.softDeadlineAt) {
          return { processed, scheduledJob, deadlineHit: true };
        }

        const workerToken = randomUUID();
        const job = await deps.claimNextCurationJob(workerToken);
        if (!job) return { processed, scheduledJob, deadlineHit: false };
        options.onJobClaimed(job);

        // Each job gets its own correlation id so its audit rows group apart
        // from the sweep's and from the next job's.
        const summary = await runWithAuditContext(
          { correlationId: workerToken },
          () => deps.runJob(job, workerToken),
        );
        processed += 1;

        // The breaker only trips when every LLM call fails at the provider,
        // which is an account-level fault the next queued job would hit too.
        // `runJob` has already alerted; claiming another job here would just
        // burn the queue against a dead provider.
        if (summary.breakerTripped) {
          console.error(
            "[curation-worker] LLM circuit breaker tripped — stopping the scheduled sweep",
          );
          return { processed, scheduledJob, deadlineHit: false };
        }
      }
    },
  );
}

function getTaipeiScheduleSlot(now: Date): Date {
  const taipeiTime = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const slotHour =
    Math.floor(taipeiTime.getUTCHours() / SCHEDULE_INTERVAL_HOURS) *
    SCHEDULE_INTERVAL_HOURS;
  taipeiTime.setUTCHours(slotHour, 0, 0, 0);
  return new Date(taipeiTime.getTime() - TAIPEI_OFFSET_MS);
}
