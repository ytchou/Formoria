import { withAuditScope } from "@/lib/audit/scope";
import { errorResponse, NO_STORE_HEADERS } from "@/lib/internal/api-response";
import { isPersonalOsRequestAuthorized } from "@/lib/internal/personal-os-auth";
import {
  getPersonalOsCurationRuns,
  normalizePersonalOsCurationRunsLimit,
  normalizePersonalOsCurationRunsWindow,
} from "@/lib/services/personal-os-curation-runs";

export const GET = withAuditScope(
  async (request: Request): Promise<Response> => {
    if (!isPersonalOsRequestAuthorized(request)) {
      return errorResponse("unauthorized", "Unauthorized", 401);
    }

    const searchParams = new URL(request.url).searchParams;
    const rawLimit = searchParams.get("limit");
    const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
    let runWindow: ReturnType<typeof normalizePersonalOsCurationRunsWindow>;
    try {
      runWindow = normalizePersonalOsCurationRunsWindow(
        searchParams.get("start"),
        searchParams.get("end"),
      );
    } catch {
      return errorResponse(
        "invalid_curation_runs_window",
        "A valid start and end window is required.",
        400,
      );
    }

    try {
      return Response.json(
        await getPersonalOsCurationRuns(
          normalizePersonalOsCurationRunsLimit(parsedLimit),
          runWindow,
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
