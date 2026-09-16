/**
 * Shared request-body primitives for pg_cron-triggered POST routes.
 *
 * Every cron route answers the same three questions before it does any work:
 * is the media type JSON, is the body inside the size cap, and is it a plain
 * object? Those answers were copied verbatim into each route. This module owns
 * them once (`parseCronBody`); the per-route allow-list and per-key validation stay in the route,
 * because those differ by job.
 *
 * Scope note: only the two DEV-1744 routes (`egress-anomaly-check`,
 * `promote-submission-images`) import this. `link-health`, `link-cleanup` and
 * `product-embeddings` still carry their own copies — migrating them is a
 * separate change, deliberately out of scope here.
 */
import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 4_096;

/**
 * Identifiers a cron caller may send verbatim. Not exported: both DEV-1744
 * routes carried this exact regex, so it is one rule, not a parameter. A route
 * needing a different shape should keep its own regex local.
 */
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

export function validString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_IDENTITY.test(value)
  );
}

/**
 * Bounded and typed, but NOT matched against `SAFE_IDENTITY`. The pg_cron jobs
 * send `run_at` as `now()::text`, which carries a space and a `+` offset.
 * Rejecting it is what silently killed the pg_cron link-health job
 * (`supabase/migrations/20260807120000_cron_http_dispatch_capture.sql`).
 */
export function validBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

/**
 * The media-type, size and shape checks common to every cron route. Returns the
 * raw object for the caller to validate key by key, or the `NextResponse` that
 * rejects it.
 */
export async function parseCronBody(
  req: Request,
): Promise<Record<string, unknown> | NextResponse> {
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

  return body as Record<string, unknown>;
}
