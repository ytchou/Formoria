import { withAuditScope } from "@/lib/audit/scope";
import { reportError } from "@/lib/observability/report-error";
import { NextRequest } from "next/server";
import { unsubscribeByToken } from "@/lib/services/email-lifecycle";
import { createServiceClient } from "@/lib/supabase/service";
import {
  emailActionLocale,
  emailActionResponse,
} from "@/lib/email/action-response";

async function unsubscribe(request: NextRequest) {
  const url = new URL(request.url);
  const locale = emailActionLocale(url);
  const token = url.searchParams.get("token");
  if (!token)
    return emailActionResponse(locale, "ownerUnsubscribe", "missing", 400);

  try {
    const result = await unsubscribeByToken(createServiceClient(), token);
    return emailActionResponse(
      locale,
      "ownerUnsubscribe",
      result.success ? "success" : "invalid",
      result.success ? 200 : 404,
    );
  } catch (error) {
    reportError(error);
    return emailActionResponse(locale, "ownerUnsubscribe", "unavailable", 503);
  }
}

export const GET = withAuditScope(unsubscribe);
export const POST = withAuditScope(unsubscribe);
