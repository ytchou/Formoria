import { withAuditScope } from "@/lib/audit/scope";
import { errorResponse, NO_STORE_HEADERS } from "@/lib/internal/api-response";
import { isPersonalOsRequestAuthorized } from "@/lib/internal/personal-os-auth";
import { getSpendSnapshot } from "@/lib/services/spend";

export const GET = withAuditScope(
  async (request: Request): Promise<Response> => {
    if (!isPersonalOsRequestAuthorized(request)) {
      return errorResponse("unauthorized", "Unauthorized", 401);
    }

    try {
      return Response.json(await getSpendSnapshot(), {
        headers: NO_STORE_HEADERS,
      });
    } catch {
      return errorResponse(
        "spend_unavailable",
        "Formoria spend data is unavailable.",
        503,
      );
    }
  },
);
