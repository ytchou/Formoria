import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import { withAuditScope } from "@/lib/audit/scope";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { refreshProductEmbeddings } from "@/lib/services/product-embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 4_096;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type RequestBody = {
  dry_run?: boolean;
  triggered_by?: string;
};

function validString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_IDENTITY.test(value)
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

  return candidate as RequestBody;
}

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseBody(req);
    if (body instanceof NextResponse) return body;

    const dryRun = body.dry_run ?? false;
    const result = await refreshProductEmbeddings({
      dryRun,
      // triggered_by from pg_cron is a plain string (e.g. "pg_cron"), not a uuid —
      // do not pass it as jobId (uuid FK on external_call_audit).
      jobId: undefined,
    });

    let slackSent = false;
    try {
      const notification: AgentNotification = {
        agent: "product-embeddings-nightly",
        status: result.failedBatches.length > 0 ? "needs_attention" : "success",
        date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }),
        summary: [
          `Stale: ${result.stale}, Embedded: ${result.embedded}, Deleted: ${result.deleted}`,
          ...(result.failedBatches.length > 0
            ? [`Failed batches: ${result.failedBatches.length}`]
            : []),
          ...(dryRun ? ["(dry run — no writes)"] : []),
        ],
      };

      console.info(
        `[product-embeddings] ${JSON.stringify({
          event: "product_embeddings_run",
          dryRun,
          stale: result.stale,
          embedded: result.embedded,
          deleted: result.deleted,
          failedBatches: result.failedBatches.length,
          slackStatus: notification.status,
        })}`,
      );

      slackSent = await postSlackAlert(notification);
    } catch (notifyError) {
      Sentry.captureException(notifyError, {
        tags: { scope: "cron", job: "product-embeddings", step: "notify" },
      });
      console.error(
        JSON.stringify({
          event: "product_embeddings_notify_failed",
          error:
            notifyError instanceof Error
              ? notifyError.message
              : "UnknownError",
        }),
      );
    }

    return NextResponse.json({
      stale: result.stale,
      embedded: result.embedded,
      deleted: result.deleted,
      failedBatches: result.failedBatches.length,
      dryRun,
      triggeredBy: body.triggered_by,
      slackSent,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: "cron", job: "product-embeddings" },
    });
    console.error(
      JSON.stringify({
        event: "product_embeddings_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
