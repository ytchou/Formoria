import { withAuditScope } from "@/lib/audit/scope";
import { errorResponse, NO_STORE_HEADERS } from "@/lib/internal/api-response";
import { isPersonalOsRequestAuthorized } from "@/lib/internal/personal-os-auth";
import {
  getPersonalOsCurationRuns,
  normalizePersonalOsCurationRunsLimit,
} from "@/lib/services/personal-os-curation-runs";

export const GET = withAuditScope(
  async (request: Request): Promise<Response> => {
    if (!isPersonalOsRequestAuthorized(request)) {
      return errorResponse("unauthorized", "Unauthorized", 401);
    }

    const rawLimit = new URL(request.url).searchParams.get("limit");
    const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);

    try {
      return Response.json(
        await getPersonalOsCurationRuns(
          normalizePersonalOsCurationRunsLimit(parsedLimit),
        ),
        { headers: NO_STORE_HEADERS },
      );
    } catch {
      return errorResponse(
        "curation_runs_unavailable",
        "Formoria curation runs are unavailable.",
        503,
      );
    }
  },
);
