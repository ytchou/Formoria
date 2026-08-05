import { captureAlert } from "@/lib/adapters/alerting/sentry";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import { auditedCall } from "@/lib/audit";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import {
  isLlmProviderFailureMessage,
  isProviderFailureMessage,
} from "@/lib/services/curation-operations";
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

/**
 * Which vendor actually went down. Both prefixes survive the throw -> per-brand
 * catch -> persisted target round trip, so the failed-brand errors are the only
 * place the job summary still remembers whether it was Serper or the LLM
 * account. The distinction is the whole point of the alert: "Serper is 400ing"
 * and "the OpenAI balance is zero" need different hands on different consoles.
 */
type ProviderBreakdown = { llm: number; search: number };

function providerBreakdown(summary: EnrichmentSummary): ProviderBreakdown {
  let llm = 0;
  let search = 0;

  for (const { error } of summary.failedBrands) {
    if (isLlmProviderFailureMessage(error)) llm += 1;
    else if (isProviderFailureMessage(error)) search += 1;
  }

  return { llm, search };
}

/**
 * Remediation copy. An all-LLM outage is almost never a code fault -- on
 * 2026-08-02 it was an exhausted OpenAI balance -- so the copy points at the
 * account first, which is what the operator has to check to end the outage.
 */
function providerAction({ llm, search }: ProviderBreakdown): string {
  if (llm > 0 && search > 0) {
    return "Both the LLM provider (OpenAI/DeepSeek) and the search provider (Serper) failed — check each account's quota, balance and API key before rerunning";
  }
  if (llm > 0) {
    return "Check the LLM provider account (OpenAI/DeepSeek): every attempted call failed at the provider, which is usually an exhausted quota/balance or a rejected API key, not a code fault. Verify billing and the key before rerunning";
  }
  if (search > 0) {
    return "Check the search provider (Serper) status and API quota before rerunning";
  }
  // The target carried the `providerFailure` flag but no prefixed message.
  return "A provider failed without naming itself — open the job run log and check the LLM (OpenAI/DeepSeek) and search (Serper) accounts before rerunning";
}

function providerLabel({ llm, search }: ProviderBreakdown): string {
  if (llm > 0 && search > 0) return "LLM and search providers";
  if (llm > 0) return "the LLM provider";
  if (search > 0) return "the search provider";
  return "a provider";
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
  if (!hasProviderFailures(summary)) return;

  return auditedCall(
    { provider: "curation", operation: "reportProviderFailures", kind: "service" },
    async () => {
      const providerFailed = summary.providerFailed ?? 0;
      const breakdown = providerBreakdown(summary);
      const message = `Curation job ${job.id}: ${providerFailed} target(s) failed because ${providerLabel(breakdown)} was unavailable`;
      const samples = summary.failedBrands
        .slice(0, 5)
        .map(({ slug, phase, error }) => `• ${slug} (${phase}): ${error}`);

      await dispatchAlert(
        {
          agent: ALERT_AGENT,
          status: "failed",
          summary: [
            `• ${providerFailed} provider failure(s) across ${summary.failed} failed target(s)`,
            `• LLM: ${breakdown.llm} · search: ${breakdown.search}`,
            `• ${summary.success} succeeded · ${summary.skipped} skipped`,
          ],
          details: [...jobDetails(job), ...samples],
          managerAction: providerAction(breakdown),
        },
        {
          message,
          context: {
            jobId: job.id,
            providerFailed,
            llmProviderFailed: breakdown.llm,
            searchProviderFailed: breakdown.search,
            failed: summary.failed,
            succeeded: summary.success,
            skipped: summary.skipped,
          },
        },
      );
    },
  );
}

/**
 * The LLM circuit breaker tripped: three consecutive targets failed every LLM
 * call at the provider, so the run was aborted and its untouched targets
 * cancelled. This is the strongest account-level signal the pipeline can
 * produce -- it is the event that must never be silent -- so it gets its own
 * alert rather than sharing `reportJobFailure`'s "inspect the worker logs"
 * copy, which points at exactly the wrong place for a billing lapse.
 */
export async function reportCircuitBreakerTrip(
  job: AlertJob,
  message: string,
): Promise<void> {
  return auditedCall(
    { provider: "curation", operation: "reportCircuitBreakerTrip", kind: "service" },
    async () => {
      await dispatchAlert(
        {
          agent: ALERT_AGENT,
          status: "failed",
          summary: [
            `• LLM circuit breaker tripped — the run was aborted, not completed`,
            `• ${message}`,
          ],
          details: [
            ...jobDetails(job),
            "• Remaining targets were cancelled, not attempted",
          ],
          managerAction:
            "Check the LLM provider account NOW (OpenAI/DeepSeek billing balance, quota, API key). The breaker only trips when every LLM call fails at the provider — no further curation will produce usable output until the account is fixed",
        },
        {
          message: `Curation job ${job.id}: LLM circuit breaker tripped — ${message}`,
          context: { jobId: job.id, circuitBreaker: "llm" },
        },
      );
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
  return auditedCall(
    { provider: "curation", operation: "reportJobFailure", kind: "service" },
    async () => {
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
  return auditedCall(
    { provider: "curation", operation: "reportWorkerFailure", kind: "service" },
    async () => {
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
    },
  );
}
