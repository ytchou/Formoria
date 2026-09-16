import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import { withAuditScope } from "@/lib/audit/scope";
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

const MAX_BODY_BYTES = 4_096;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type RequestBody = {
  always_notify?: boolean;
  triggered_by?: string;
  run_at?: string;
};

function validString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_IDENTITY.test(value)
  );
}

/**
 * `run_at` is bounded and typed but NOT matched against `SAFE_IDENTITY`: the
 * pg_cron job sends `now()::text`, which carries a space and a `+` offset.
 * Rejecting it is what silently killed the pg_cron link-health job
 * (`supabase/migrations/20260807120000_cron_http_dispatch_capture.sql`).
 */
function validBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

async function parseBody(req: Request): Promise<RequestBody | NextResponse> {
  const contentType = req.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json(
      { error: "Unsupported media type" },
      { status: 415 },
    );
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
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
