import { NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { isBearerAuthorized } from "@/lib/internal/personal-os-auth";
import {
  claimDispatch,
  completeDispatch,
} from "@/lib/services/ops-agent/dispatches";
import type { DispatchOutcome } from "@/lib/services/ops-agent/types";
import { isUuid } from "@/lib/validation/id-batch";

/**
 * Claim endpoint for ops-bot e2e dispatches. The staging e2e-nightly-agent
 * calls this on the production Railway origin (exempt from the origin guard in
 * `src/proxy.ts`) with `Authorization: Bearer <E2E_DISPATCH_SECRET>`.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;
const SECRET_ENV = "E2E_DISPATCH_SECRET";
const OUTCOMES = new Set<DispatchOutcome>([
  "green",
  "red",
  "errored",
  "crashed",
]);

type DispatchRequest =
  | { action: "claim"; runId: string }
  | {
      action: "complete";
      dispatchId: string;
      runId: string;
      outcome: DispatchOutcome;
    };

export type E2eDispatchRouteDeps = {
  claimDispatch: (runId: string) => ReturnType<typeof claimDispatch>;
  completeDispatch: (
    id: string,
    runId: string,
    outcome: DispatchOutcome,
  ) => ReturnType<typeof completeDispatch>;
};

const defaultDeps: E2eDispatchRouteDeps = {
  claimDispatch: (runId) => claimDispatch(runId),
  completeDispatch: (id, runId, outcome) =>
    completeDispatch(id, runId, outcome),
};

function invalid(): NextResponse {
  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

async function parseBody(
  req: Request,
): Promise<DispatchRequest | NextResponse> {
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
    return invalid();
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid();
  }

  const candidate = body as Record<string, unknown>;
  if (!isUuidString(candidate.runId)) return invalid();

  if (candidate.action === "claim") {
    return { action: "claim", runId: candidate.runId };
  }

  if (candidate.action === "complete") {
    const { dispatchId, outcome } = candidate;
    if (!isUuidString(dispatchId)) return invalid();
    if (
      typeof outcome !== "string" ||
      !OUTCOMES.has(outcome as DispatchOutcome)
    ) {
      return invalid();
    }
    return {
      action: "complete",
      dispatchId,
      runId: candidate.runId,
      outcome: outcome as DispatchOutcome,
    };
  }

  return invalid();
}

export function createE2eDispatchHandler(
  deps: E2eDispatchRouteDeps = defaultDeps,
) {
  return withAuditScope(async (request: Request) => {
    if (!isBearerAuthorized(request, SECRET_ENV)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseBody(request);
    if (body instanceof NextResponse) return body;

    if (body.action === "claim") {
      const dispatch = await deps.claimDispatch(body.runId);
      return NextResponse.json({
        dispatch: dispatch
          ? {
              id: dispatch.id,
              channelId: dispatch.channelId,
              threadTs: dispatch.threadTs,
              requesterId: dispatch.requesterId,
            }
          : null,
      });
    }

    const updated = await deps.completeDispatch(
      body.dispatchId,
      body.runId,
      body.outcome,
    );
    return NextResponse.json({ ok: true, updated });
  });
}

export const POST = createE2eDispatchHandler();
