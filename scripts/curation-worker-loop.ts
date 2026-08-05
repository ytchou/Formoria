import { randomUUID } from "node:crypto";
import { runWithAuditContext } from "@/lib/audit/context";

type DrainJobQueueOptions<Job extends { id: string }> = {
  initialJob: Job;
  workerToken: string;
  runJob: (job: Job, workerToken: string) => Promise<unknown>;
  claimNextJob: (workerToken: string) => Promise<Job | null>;
  onJobClaimed?: (job: Job) => void;
  onJobSettled?: (job: Job) => void;
};

export async function drainJobQueue<Job extends { id: string }>(
  options: DrainJobQueueOptions<Job>,
): Promise<void> {
  let currentJob: Job | null = options.initialJob;
  let currentToken = options.workerToken;

  while (currentJob) {
    const jobToRun = currentJob;

    try {
      await runWithAuditContext({ correlationId: currentToken }, () =>
        options.runJob(jobToRun, currentToken),
      );
    } finally {
      options.onJobSettled?.(jobToRun);
    }

    currentToken = randomUUID();
    currentJob = await options.claimNextJob(currentToken);
    if (currentJob) {
      options.onJobClaimed?.(currentJob);
    }
  }
}

export function runInCronScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithAuditContext({}, fn);
}

export function startStaleJobMaintenance(
  options: {
    recoverStaleJobs: () => Promise<unknown>;
    onError: (error: unknown) => void;
    intervalMs?: number;
  },
): NodeJS.Timeout {
  const { recoverStaleJobs, onError, intervalMs = 60_000 } = options;
  let inFlight = false;
  const interval = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void runWithAuditContext({}, recoverStaleJobs)
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  interval.unref();
  return interval;
}
