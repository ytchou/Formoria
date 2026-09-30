import { sanitizeJobError } from "./job-errors";
import { auditedCall } from "@/lib/audit";
import { runCurationWorkerNow } from "@/lib/adapters/railway/api";
import { isStagingEnvironment } from "@/lib/deployment-environment";

export function sanitizeDispatchError(error: unknown): string {
  return sanitizeJobError(error, 1_000);
}

/**
 * Requests one run of the curation-worker Railway cron ("Run now"). The run
 * drains every pending job in order, so `jobId` is only recorded for tracing.
 */
export async function dispatchCurationJob(
  jobId: string,
): Promise<{ accepted: true; status: string }> {
  return auditedCall(
    { provider: "curation", operation: "dispatchCurationJob", kind: "service" },
    async (ctx) => {
      ctx.summary.jobId = jobId;

      if (isStagingEnvironment()) {
        throw new Error(
          "Curation worker runs in production only; staging runs curation in-process (scripts/enrichment/run/refresh.ts)",
        );
      }

      const run = await runCurationWorkerNow();
      if (!run.ok) {
        throw new Error(
          `Worker run request failed: ${sanitizeDispatchError(run.error)}`,
        );
      }

      return { accepted: true as const, status: "requested" };
    },
  );
}
