import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withAuditScope } from "@/lib/audit/scope";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { syncMitRegistry } from "@/lib/services/mit-registry";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withAuditScope(async (request: Request) => {
  if (!isAuthorizedMachineCaller(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncMitRegistry());
  } catch (error) {
    Sentry.captureException(error, {
      tags: { scope: "cron", job: "sync-mit-registry" },
    });
    console.error(
      JSON.stringify({
        event: "mit_registry_sync_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
});
