import { randomUUID } from "node:crypto";
import {
  claimNextCurationJob,
  enqueueScheduledSubmissionJob,
  ensureAutomaticRetries,
  recoverStaleJobs,
  type CurationJob,
} from "@/lib/services/curation-jobs";
import { runJob } from "@/lib/services/job-runner";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const SCHEDULE_INTERVAL_HOURS = 6;

export type ScheduledCurationRun = {
  processed: number;
  scheduledJob: CurationJob | null;
};

export async function runScheduledCuration(
  now = new Date(),
): Promise<ScheduledCurationRun> {
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

    await runJob(job, workerToken);
    processed += 1;

    workerToken = randomUUID();
    job = await claimNextCurationJob(workerToken);
  }
}

export function getTaipeiScheduleSlot(now: Date): Date {
  const taipeiTime = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const slotHour =
    Math.floor(taipeiTime.getUTCHours() / SCHEDULE_INTERVAL_HOURS) *
    SCHEDULE_INTERVAL_HOURS;
  taipeiTime.setUTCHours(slotHour, 0, 0, 0);
  return new Date(taipeiTime.getTime() - TAIPEI_OFFSET_MS);
}
