import { withAuditScope } from "@/lib/audit/scope";
import { isPersonalOsRequestAuthorized } from "@/lib/internal/personal-os-auth";
import { refreshExecutiveHealth } from "@/lib/services/executive-health";
import { errorResponse, NO_STORE_HEADERS } from "@/lib/internal/api-response";

export const maxDuration = 30;

export const POST = withAuditScope(
  async (request: Request): Promise<Response> => {
    if (!isPersonalOsRequestAuthorized(request)) {
      return errorResponse("unauthorized", "Unauthorized", 401);
    }

    try {
      return Response.json(
        { schemaVersion: 1 as const, ...(await refreshExecutiveHealth()) },
        { headers: NO_STORE_HEADERS },
      );
    } catch {
      return errorResponse(
        "system_status_unavailable",
        "Formoria system status is unavailable.",
        503,
      );
    }
  },
);
