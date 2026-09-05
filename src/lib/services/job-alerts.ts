import { captureAlert } from "@/lib/adapters/alerting/sentry";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import { auditedCall } from "@/lib/audit";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import {
  isLlmProviderFailureMessage,
  isProviderFailureMessage,
} from "@/lib/services/curation-operations";
import type { EnrichmentSummary } from "@/lib/services/enrichment-logger";
import { routes } from "@/lib/routes";

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
    return "Both the LLM provider (OpenAI) and the search provider (Serper) failed — check each account's quota, balance and API key before rerunning";
  }
  if (llm > 0) {
    return "Check the LLM provider account (OpenAI): every attempted call failed at the provider, which is usually an exhausted quota/balance or a rejected API key, not a code fault. Verify billing and the key before rerunning";
  }
  if (search > 0) {
    return "Check the search provider (Serper) status and API quota before rerunning";
  }
  // The target carried the `providerFailure` flag but no prefixed message.
  return "A provider failed without naming itself — open the job run log and check the LLM (OpenAI) and search (Serper) accounts before rerunning";
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
 * One message per job, never one per verdict.
 *
 * The finalizer can reject a submission or hide an approved brand without any
 * human in the loop, so every acted-on slug has to be enumerated somewhere a
 * person reads by default — but a per-verdict post would bury a 30-brand
 * cohort's other alerts. A job that acted on nothing posts nothing.
 *
 * `reportOnly` (the `CHANNEL_VERDICTS=off` rollout position) still posts, so
 * the dry pass is reviewable, and labels itself so nobody reads it as a
 * delisting that already happened.
 */
export type ChannelVerdictReport = {
  noChannelRejected: number;
  noChannelHidden: number;
  verdictSkipped?: number;
  hideFailed?: number;
  reportOnly: boolean;
  targets: ReadonlyArray<{ slug: string; action: string; reason?: string }>;
};

const VERDICT_ACTION_LABELS: Record<string, string> = {
  rejected: "rejected",
  hidden: "hidden",
  would_reject: "would be rejected",
  would_hide: "would be hidden",
};

function jobLink(jobId: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const path = routes.admin.job(jobId);
  return siteUrl ? `${siteUrl}${path}` : path;
}

export async function reportChannelVerdicts(
  job: AlertJob,
  verdict: ChannelVerdictReport,
): Promise<void> {
  const acted = verdict.targets.filter(
    (target) => target.action in VERDICT_ACTION_LABELS,
  );
  if (acted.length === 0) return;

  return auditedCall(
    { provider: "curation", operation: "reportChannelVerdicts", kind: "service" },
    async () => {
      const prefix = verdict.reportOnly ? "report-only: " : "";
      const rejected = verdict.reportOnly
        ? acted.filter((target) => target.action === "would_reject").length
        : verdict.noChannelRejected;
      const hidden = verdict.reportOnly
        ? acted.filter((target) => target.action === "would_hide").length
        : verdict.noChannelHidden;

      await dispatchAlert(
        {
          agent: ALERT_AGENT,
          status: "needs_attention",
          summary: [
            `• ${prefix}${rejected} submission(s) rejected and ${hidden} brand(s) hidden for having no purchase channel`,
            ...(verdict.hideFailed
              ? [`• ${verdict.hideFailed} hide(s) failed — those refreshes stay pending`]
              : []),
            ...(verdict.verdictSkipped
              ? [`• ${verdict.verdictSkipped} verdict(s) errored and were skipped`]
              : []),
          ],
          details: [
            ...jobDetails(job),
            `• Job page: ${jobLink(job.id)}`,
            ...acted.map(
              (target) =>
                `• ${target.slug}: ${VERDICT_ACTION_LABELS[target.action]}`,
            ),
          ],
          managerAction: verdict.reportOnly
            ? "Report-only pass: nothing was written. Review the listed brands, then remove CHANNEL_VERDICTS=off to let the finalizer act"
            : "Open the job page and spot-check the listed brands. A wrong hide is undone with Unhide; a wrong rejection with Reopen",
        },
        {
          message: `${prefix}Curation job ${job.id}: ${rejected} rejected, ${hidden} hidden for no purchase channel`,
          context: {
            jobId: job.id,
            noChannelRejected: rejected,
            noChannelHidden: hidden,
            hideFailed: verdict.hideFailed ?? 0,
            verdictSkipped: verdict.verdictSkipped ?? 0,
            reportOnly: String(verdict.reportOnly),
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
            "Check the LLM provider account NOW (OpenAI billing balance, quota, API key). The breaker only trips when every LLM call fails at the provider — no further curation will produce usable output until the account is fixed",
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
