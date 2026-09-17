import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import { withAuditScope } from "@/lib/audit/scope";
import {
  parseCronBody,
  validBoundedString,
  validString,
} from "@/lib/http/cron-body";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import {
  buildSweepSummary,
  sweepPendingPromotions,
} from "@/lib/services/promote-submission-images";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = {
  always_notify?: boolean;
  triggered_by?: string;
  run_at?: string;
};

/**
 * Media type, size cap and object shape come from `@/lib/http/cron-body`; the
 * allow-list and the per-key rules below are this job's own contract.
 */
async function parseBody(req: Request): Promise<RequestBody | NextResponse> {
  const candidate = await parseCronBody(req);
  if (candidate instanceof NextResponse) return candidate;

  // No `dry_run` key on purpose: this is the scheduled, authoritative sweep.
  // An auditing dry run is the operator CLI
  // (`scripts/enrichment/images/promote-submission-images.ts`).
  const allowedKeys = new Set(["always_notify", "triggered_by", "run_at"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    candidate.always_notify !== undefined &&
    typeof candidate.always_notify !== "boolean"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    candidate.triggered_by !== undefined &&
    !validString(candidate.triggered_by, 64)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    candidate.run_at !== undefined &&
    !validBoundedString(candidate.run_at, 64)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  return candidate as RequestBody;
}

/**
 * DEV-1744 — the daily sweep that promotes every `brand_images` row still under
 * `submissions/` into `brands/`, scheduled by pg_cron through
 * `cron_http_dispatch`.
 *
 * This is the safety net under `promoteApprovedBrandImages`, which runs at the
 * approval boundary and is deliberately allowed to fail without failing the
 * approval. Residue left by that path becomes unservable imagery, so this route
 * is what bounds the exposure to one cron interval. A non-zero `failed` is the
 * signal the Slack alert carries: residue that did not converge is the
 * precondition for the bucket flip (task 3) and must not pass silently.
 */
export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseBody(req);
    if (body instanceof NextResponse) return body;

    const result = await sweepPendingPromotions();
    if (result === null) {
      // The row read itself failed, so nothing was attempted. The sweep never
      // throws, so this is the only signal that the run did not happen.
      throw new Error("Promotion sweep could not be attempted");
    }

    const summary = buildSweepSummary(result);

    let slackSent = false;
    try {
      // Inside this catch on purpose: the promotion writes already landed and
      // are reported in the body below, so a failing webhook must never turn a
      // successful sweep into a 500.
      const notification: AgentNotification = {
        agent: "promote-submission-images-daily",
        status: summary.failed > 0 ? "needs_attention" : "success",
        date: new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Taipei",
        }),
        summary: [
          `Scanned: ${summary.scanned}, Promoted: ${summary.promoted} (copied ${summary.copied}, adopted ${summary.adopted})`,
          `Skipped: ${summary.skipped}`,
          ...(summary.failed > 0
            ? [
                `Still under submissions/: ${summary.failed} (failures ${result.failures.length}, conflicts ${summary.conflicts}, unresolvable ${summary.unresolvable})`,
              ]
            : []),
        ],
      };

      console.info(
        `[promote-submission-images] ${JSON.stringify({
          event: "promote_submission_images_run",
          ...summary,
          slackStatus: notification.status,
        })}`,
      );

      // Same rule as `egress-anomaly-check`: only a run that needs attention
      // reaches Slack, because a daily green line nobody reads is how a real
      // one gets scrolled past. `always_notify` is the manual override.
      if (body.always_notify || notification.status !== "success") {
        slackSent = await postSlackAlert(notification);
      }
    } catch (notifyError) {
      Sentry.captureException(notifyError, {
        tags: {
          scope: "cron",
          job: "promote-submission-images",
          step: "notify",
        },
      });
      console.error(
        JSON.stringify({
          event: "promote_submission_images_notify_failed",
          error:
            notifyError instanceof Error ? notifyError.name : "UnknownError",
        }),
      );
    }

    return NextResponse.json({
      ...summary,
      triggeredBy: body.triggered_by,
      slackSent,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: "cron", job: "promote-submission-images" },
    });
    console.error(
      JSON.stringify({
        event: "promote_submission_images_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
