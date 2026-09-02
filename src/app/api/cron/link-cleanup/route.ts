import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import {
  buildLinkCleanupNotification,
  cleanupDeadLinks,
  listRecentRemovals,
} from "@/lib/services/link-cleanup";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 4_096;
const RECENT_REMOVAL_WINDOW_HOURS = 24;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type RequestBody = {
  dry_run?: boolean;
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
 * `run_at` is bounded and typed, but NOT matched against `SAFE_IDENTITY`: the
 * pg_cron job sends `now()::text`, which carries a space and a `+` offset
 * (`2026-09-02 21:30:00.123456+00`). The route never parses the value — it is
 * provenance for a human reading logs — so a length cap is the whole contract.
 * Rejecting it would repeat the failure that silently killed the pg_cron
 * link-health job (`supabase/migrations/20260807120000_cron_http_dispatch_capture.sql`).
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
  const allowedKeys = new Set(["dry_run", "triggered_by", "run_at"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    candidate.dry_run !== undefined &&
    typeof candidate.dry_run !== "boolean"
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
 * The nightly dead-link cleanup (DEV-1318), scheduled by pg_cron through
 * `cron_http_dispatch`. Replaces `.github/workflows/link-cleanup.yml`.
 *
 * The route only validates, calls the service, and posts the notification the
 * service builds. Two catch scopes on purpose: a Slack webhook that throws is
 * reported and ignored (the cleanup already happened, and the counts are in the
 * response), while a failing cleanup is a 500.
 */
export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseBody(req);
    if (body instanceof NextResponse) return body;

    const dryRun = body.dry_run ?? false;
    const result = await cleanupDeadLinks({ dryRun });
    const recent = await listRecentRemovals(RECENT_REMOVAL_WINDOW_HOURS);

    let slackSent = false;
    try {
      slackSent = await postSlackAlert(
        buildLinkCleanupNotification(result, !dryRun, recent),
      );
    } catch (slackError) {
      // `postSlackAlert` throws on a non-2xx webhook response. The cleanup is
      // already done and reported in the body below, so a failed notification
      // must not turn a successful run into a 500.
      Sentry.captureException(slackError, {
        tags: { scope: "cron", job: "link-cleanup", step: "slack" },
      });
      console.error(
        JSON.stringify({
          event: "link_cleanup_slack_failed",
          error: slackError instanceof Error ? slackError.name : "UnknownError",
        }),
      );
    }

    return NextResponse.json({
      applied: result.applied.length,
      scanned: result.scanned,
      skipped: result.skipped.length,
      slackSent,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: "cron", job: "link-cleanup" },
    });
    console.error(
      JSON.stringify({
        event: "link_cleanup_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
