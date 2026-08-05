import { randomUUID } from "node:crypto";
import {
  claimNextCurationJob,
  enqueueScheduledSubmissionJob,
  ensureAutomaticRetries,
  recoverStaleJobs,
  type CurationJob,
} from "@/lib/services/curation-jobs";
import { runJob } from "@/lib/services/job-runner";
import { auditedCall } from "@/lib/audit";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const SCHEDULE_INTERVAL_HOURS = 6;

export type ScheduledCurationRun = {
  processed: number;
  scheduledJob: CurationJob | null;
};

export async function runScheduledCuration(
  now = new Date(),
): Promise<ScheduledCurationRun> {
  return auditedCall(
    { provider: "curation", operation: "runScheduledCuration", kind: "service" },
    async () => {
      await recoverStaleJobs();
      await ensureAutomaticRetries();

      let scheduledJob: CurationJob | null = null;
      let processed = 0;
      scheduledJob = await enqueueScheduledSubmissionJob(
        getTaipeiScheduleSlot(now),
      );
      let workerToken = randomUUID();
      let job = await claimNextCurationJob(workerToken);

      while (true) {
        if (!job) return { processed, scheduledJob };

        const summary = await runJob(job, workerToken);
        processed += 1;

        // The breaker only trips when every LLM call fails at the provider,
        // which is an account-level fault the next queued job would hit too.
        // `runJob` has already alerted; claiming another job here would just
        // burn the queue against a dead provider.
        if (summary.breakerTripped) {
          console.error(
            "[curation-worker] LLM circuit breaker tripped — stopping the scheduled sweep",
          );
          return { processed, scheduledJob };
        }

        workerToken = randomUUID();
        job = await claimNextCurationJob(workerToken);
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
