import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { loadSpendReport } from "@/lib/services/spend-report";

export const runtime = "nodejs";
export const maxDuration = 300;

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await loadSpendReport();
    return NextResponse.json(report);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "spend_report_route_failed",
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
});
