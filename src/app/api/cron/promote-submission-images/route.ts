import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import { withAuditScope } from "@/lib/audit/scope";
import type { PromotionResult } from "@/lib/images/submission-image-promotion";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { sweepPendingPromotions } from "@/lib/services/promote-submission-images";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 4_096;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type RequestBody = {
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
 * pg_cron job sends `now()::text`, which carries a space and a `+` offset.
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
  // No `dry_run` key on purpose: this is the scheduled, authoritative sweep.
  // An auditing dry run is the operator CLI
  // (`scripts/enrichment/images/promote-submission-images.ts`).
  const allowedKeys = new Set(["triggered_by", "run_at"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
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

export type SweepSummary = {
  scanned: number;
  promoted: number;
  copied: number;
  adopted: number;
  skipped: number;
  unresolvable: number;
  conflicts: number;
  failed: number;
};

/**
 * The response body, and the only place the counts are derived. Pure, so the
 * reporting contract is testable without a Supabase client — the repo forbids
 * mocking one, and the sweep's own behavior is covered in
 * `src/lib/services/__tests__/promote-submission-images.test.ts`.
 *
 * `failed` counts rows still stuck under `submissions/` after the run:
 * execution failures, target conflicts, and rows the planner could not resolve.
 * All three are the same operational fact — an image that is still unservable.
 */
export function buildSweepSummary(result: PromotionResult): SweepSummary {
  return {
    scanned: result.plan.scanned,
    promoted: result.copied + result.adopted,
    copied: result.copied,
    adopted: result.adopted,
    skipped: result.plan.skipped.length,
    unresolvable: result.plan.unresolvable.length,
    conflicts: result.conflicts.length,
    failed:
      result.failures.length +
      result.conflicts.length +
      result.plan.unresolvable.length,
  };
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

      slackSent = await postSlackAlert(notification);
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
