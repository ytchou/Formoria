import { withAuditScope } from "@/lib/audit/scope";
import { errorResponse, NO_STORE_HEADERS } from "@/lib/internal/api-response";
import { isPersonalOsRequestAuthorized } from "@/lib/internal/personal-os-auth";
import { getExecutiveHealth } from "@/lib/services/executive-health";

export const maxDuration = 30;

export const GET = withAuditScope(
  async (request: Request): Promise<Response> => {
    if (!isPersonalOsRequestAuthorized(request)) {
      return errorResponse("unauthorized", "Unauthorized", 401);
    }

    try {
      return Response.json(
        { schemaVersion: 1 as const, ...(await getExecutiveHealth()) },
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
