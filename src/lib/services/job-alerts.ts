import { captureAlert } from "@/lib/adapters/alerting/sentry";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import type { EnrichmentSummary } from "@/lib/services/enrichment-logger";

/**
 * Curation job alerting.
 *
 * A search-provider outage does NOT surface as a thrown job error: a Serper 400
 * returns a failed result object, Gate A turns it into a per-brand throw, and
 * the per-brand catch records a FAILED target and continues — so the job
 * finalizes as `completed`. The alert therefore has to be driven off the job
 * summary's provider-failure counter, not off an exception. `failed_count`
 * alone is not enough: ordinary data gaps also fail targets and must not page.
 *
 * Every entry point swallows adapter errors. Alerting must never change a job's
 * status and must never throw into job execution.
 */

export type AlertJob = {
  id: string;
  operation?: string;
  trigger?: string;
};

const ALERT_AGENT = "Curation";

/** True when this job summary describes a provider outage worth paging on. */
export function hasProviderFailures(summary: EnrichmentSummary): boolean {
  return (summary.providerFailed ?? 0) > 0;
}

function jobDetails(job: AlertJob): string[] {
  return [
    `• Job: \`${job.id}\``,
    ...(job.operation ? [`• Operation: ${job.operation}`] : []),
    ...(job.trigger ? [`• Trigger: ${job.trigger}`] : []),
  ];
}

/**
 * Fans an alert out to Sentry and Slack. Each adapter is isolated: one failing
 * never stops the other, and neither can reject.
 */
async function dispatchAlert(
  notification: AgentNotification,
  sentry: {
    message: string;
    context: Record<string, string | number>;
    error?: unknown;
  },
): Promise<void> {
  try {
    captureAlert(sentry.message, {
      level: "error",
      context: sentry.context,
      ...(sentry.error !== undefined ? { error: sentry.error } : {}),
    });
  } catch (error) {
    console.error("[job-alerts:sentry]", errorText(error));
  }

  try {
    await postSlackAlert(notification);
  } catch (error) {
    console.error("[job-alerts:slack]", errorText(error));
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Called from the SUCCESS branch of the job runner, where a provider outage
 * actually lands (the job finalizes as `completed` with failed targets).
 * No-ops when the summary carries no provider failures.
 */
export async function reportProviderFailures(
  job: AlertJob,
  summary: EnrichmentSummary,
): Promise<void> {
  if (!hasProviderFailures(summary)) {
    return;
  }

  const providerFailed = summary.providerFailed ?? 0;
  const message = `Curation job ${job.id}: ${providerFailed} target(s) failed because a search/LLM provider was unavailable`;
  const samples = summary.failedBrands
    .slice(0, 5)
    .map(({ slug, phase, error }) => `• ${slug} (${phase}): ${error}`);

  await dispatchAlert(
    {
      agent: ALERT_AGENT,
      status: "failed",
      summary: [
        `• ${providerFailed} provider failure(s) across ${summary.failed} failed target(s)`,
        `• ${summary.success} succeeded · ${summary.skipped} skipped`,
      ],
      details: [...jobDetails(job), ...samples],
      managerAction:
        "Check the search provider (Serper) status and API quota before rerunning",
    },
    {
      message,
      context: {
        jobId: job.id,
        providerFailed,
        failed: summary.failed,
        succeeded: summary.success,
        skipped: summary.skipped,
      },
    },
  );
}

/**
 * Called from the job runner's catch — a genuine process-level failure that
 * marked the whole job `failed`.
 */
export async function reportJobFailure(
  job: AlertJob,
  error: unknown,
): Promise<void> {
  const message = `Curation job ${job.id} failed: ${errorText(error)}`;

  await dispatchAlert(
    {
      agent: ALERT_AGENT,
      status: "failed",
      summary: [`• ${errorText(error)}`],
      details: jobDetails(job),
      managerAction: "Inspect the worker logs and rerun the job once fixed",
    },
    {
      message,
      context: { jobId: job.id },
      error,
    },
  );
}

/**
 * Called from the worker process itself (cron catch, floating job promise,
 * unhandled rejections) where there may be no job context at all.
 */
export async function reportWorkerFailure(
  context: string,
  error: unknown,
): Promise<void> {
  const message = `Curation worker failure (${context}): ${errorText(error)}`;

  await dispatchAlert(
    {
      agent: ALERT_AGENT,
      status: "failed",
      summary: [`• ${errorText(error)}`],
      details: [`• Source: ${context}`],
      managerAction: "Inspect the curation worker container logs",
    },
    {
      message,
      context: { source: context },
      error,
    },
  );
}
