import { withAuditScope } from "@/lib/audit/scope";
import { reportError } from "@/lib/observability/report-error";
import { NextRequest } from "next/server";
import { unsubscribeNewsletter } from "@/lib/services/newsletter";
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
    return emailActionResponse(locale, "newsletterUnsubscribe", "missing", 400);

  try {
    const result = await unsubscribeNewsletter(createServiceClient(), token);
    return emailActionResponse(
      locale,
      "newsletterUnsubscribe",
      result.success ? "success" : "invalid",
      result.success ? 200 : 404,
    );
  } catch (error) {
    reportError(error);
    return emailActionResponse(
      locale,
      "newsletterUnsubscribe",
      "unavailable",
      503,
    );
  }
}

export const GET = withAuditScope(unsubscribe);
export const POST = withAuditScope(unsubscribe);
