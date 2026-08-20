import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { loadTrailSupplyReport } from "@/lib/services/trail-supply-report";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The nightly trail supply-decay observation (DEV-1520).
 *
 * A GET because it is a read-only report with no request body, exactly like
 * `/api/cron/spend-report`. Machine callers only — no public surface consumes
 * it, and no public surface changes because of it: the report names decayed
 * sections for the founder and the health agent, and decides nothing about what
 * a visitor sees.
 *
 * `readUnavailable: true` is a normal 200. Dormancy is the EXPECTED production
 * state while `curated_products` is a stub, and a scheduled run whose branch
 * carries no `content/trails/` directory reports it too. Turning that into a
 * 5xx would page someone nightly for a system working as designed; the caller
 * reads the flag and emits nothing.
 */
export const GET = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await loadTrailSupplyReport();
    return NextResponse.json(report);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "trail_supply_report_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
