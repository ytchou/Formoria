import { NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { isOpsRoutineAuthorized } from "@/lib/internal/personal-os-auth";
import { applyRoutineTimelineEvent } from "@/lib/services/run-timeline/relay";

/**
 * Relay endpoint for the ops routine to append routine-owned events
 * (pr_opened, tickets_filed, completed, failed) to a run's Slack timeline.
 * Called on the Railway origin, which is exempt from the origin guard in
 * `src/proxy.ts`.
 *
 * POST /api/internal/run-timeline
 * Authorization: Bearer <OPS_ROUTINE_CALLBACK_TOKEN>
 * Body: { channel, ts, event }
 */

export const runtime = "nodejs";

export type RunTimelineRouteDeps = {
  applyRoutineTimelineEvent: typeof applyRoutineTimelineEvent;
};

const defaultDeps: RunTimelineRouteDeps = { applyRoutineTimelineEvent };

export function createRunTimelineHandler(deps: RunTimelineRouteDeps = defaultDeps) {
  return withAuditScope(async (request: Request) => {
    if (!isOpsRoutineAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const result = await deps.applyRoutineTimelineEvent(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    // A missed append is a relay failure the routine must surface; the
    // write-back result is still returned so a retry is safe (it is idempotent).
    return NextResponse.json(result, { status: result.appended ? 200 : 502 });
  });
}

export const POST = createRunTimelineHandler();
