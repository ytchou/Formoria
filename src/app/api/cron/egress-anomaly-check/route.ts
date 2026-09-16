import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import { withAuditScope } from "@/lib/audit/scope";
import {
  parseCronBody,
  validBoundedString,
  validString,
} from "@/lib/http/cron-body";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import {
  buildEgressAnomalyNotification,
  checkEgressAnomaly,
} from "@/lib/services/egress-monitoring";

/**
 * Daily image-egress anomaly check (DEV-1744, task 5), scheduled by pg_cron
 * through `cron_http_dispatch`.
 *
 * HTTP wiring only: the Cloudflare query, the threshold comparison and the
 * message body all live in `@/lib/services/egress-monitoring`. The route
 * decides one thing the service cannot — whether to post at all. Only a
 * non-`success` report reaches Slack, because a daily green line nobody reads
 * is how a real one gets scrolled past.
 */
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

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseBody(req);
    if (body instanceof NextResponse) return body;

    const report = await checkEgressAnomaly();
    const notification = buildEgressAnomalyNotification(report);

    let slackSent = false;
    try {
      // Logged before the post, and outside the notify condition: the reading
      // must exist in the run log even on the quiet days when nothing is sent
      // and even when the webhook is missing or failing.
      console.info(
        `[egress-anomaly-check] ${JSON.stringify({
          event: "egress_anomaly_check_run",
          state: report.state,
          risk: report.risk,
          exceeded: report.exceeded,
          worstDay: report.worstDay,
          limitBytes: report.limitBytes,
          window: report.window,
        })}`,
      );

      if (body.always_notify || notification.status !== "success") {
        slackSent = await postSlackAlert(notification);
      }
    } catch (notifyError) {
      // `postSlackAlert` throws on a non-2xx webhook response. The reading is
      // already in the log and in the response body, so a failed notification
      // must not turn a successful check into a 500.
      Sentry.captureException(notifyError, {
        tags: { scope: "cron", job: "egress-anomaly-check", step: "notify" },
      });
      console.error(
        JSON.stringify({
          event: "egress_anomaly_check_notify_failed",
          error:
            notifyError instanceof Error ? notifyError.name : "UnknownError",
        }),
      );
    }

    return NextResponse.json({
      state: report.state,
      risk: report.risk,
      exceeded: report.exceeded,
      worstDay: report.worstDay,
      limitBytes: report.limitBytes,
      window: report.window,
      message: report.message,
      triggeredBy: body.triggered_by,
      slackSent,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: "cron", job: "egress-anomaly-check" },
    });
    console.error(
      JSON.stringify({
        event: "egress_anomaly_check_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
