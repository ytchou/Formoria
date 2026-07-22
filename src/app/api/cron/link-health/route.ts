import { NextResponse } from "next/server";
import { runLinkHealthCheck } from "@/lib/services/link-health";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 4_096;
const MAX_WORKFLOW_ATTEMPT = 1_000_000;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type RequestBody = {
  dry_run?: boolean;
  run_identity?: string;
  workflow_attempt?: number;
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
  const allowedKeys = new Set(["dry_run", "run_identity", "workflow_attempt"]);
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
    candidate.run_identity !== undefined &&
    !validString(candidate.run_identity, 128)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (
    candidate.workflow_attempt !== undefined &&
    (!Number.isSafeInteger(candidate.workflow_attempt) ||
      (candidate.workflow_attempt as number) <= 0 ||
      (candidate.workflow_attempt as number) > MAX_WORKFLOW_ATTEMPT)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (candidate.dry_run !== true && !validString(candidate.run_identity, 128)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  return candidate as RequestBody;
}

export async function POST(req: Request) {
  if (req.headers.get("x-origin-verify") !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseBody(req);
    if (body instanceof NextResponse) return body;

    const summary = await runLinkHealthCheck({
      dryRun: body.dry_run ?? false,
      runIdentity: body.run_identity,
      workflowAttempt: body.workflow_attempt,
    });
    return NextResponse.json(summary);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "link_health_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
