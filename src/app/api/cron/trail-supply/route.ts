import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { loadTrailSupplyReport } from "@/lib/services/trail-supply-report";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The nightly trail supply-decay observation (DEV-1520).
 *
 * A GET, and the only one under `/api/cron/`: every sibling route is a POST.
 * The divergence is deliberate — this route performs no write, takes no request
 * body, and returns a report — but it is a divergence, so the response is
 * pinned `no-store`. A GET is cacheable by intermediaries where a POST is not,
 * and a cached supply report is a stale one presented as tonight's.
 *
 * Machine callers only — no public surface consumes it, and no public surface
 * changes because of it: the report names decayed sections for the founder and
 * the health agent, and decides nothing about what a visitor sees.
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
    return NextResponse.json(report, {
      headers: {
        // The plan's performance budget: this route must not be cached.
        "Cache-Control": "no-store",
        // The response is a function of the caller's credential, so anything
        // that does cache it must key on the header the gate above reads.
        Vary: "x-origin-verify",
      },
    });
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
