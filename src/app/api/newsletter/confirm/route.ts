import { withAuditScope } from "@/lib/audit/scope";
import { captureException } from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { confirmSubscriber } from "@/lib/services/newsletter";
import { createServiceClient } from "@/lib/supabase/service";
import { getPublicOrigin } from "@/lib/url";
import { isAppLocale } from "@/i18n/locale-preference";
import {
  emailActionHeaders,
  emailActionLocale,
  emailActionResponse,
} from "@/lib/email/action-response";
import { buildConfirmRedirectUrl, extractToken } from "./helpers";

export const GET = withAuditScope(async (request: NextRequest) => {
  const url = new URL(request.url);
  const locale = emailActionLocale(url);
  const token = extractToken(url);
  if (!token)
    return emailActionResponse(locale, "confirmation", "missing", 400);

  try {
    const result = await confirmSubscriber(createServiceClient(), token);
    if (!result.success)
      return emailActionResponse(locale, "confirmation", "invalid", 400);
    const subscriberLocale = result.subscriber?.locale;
    const confirmedLocale = isAppLocale(subscriberLocale)
      ? subscriberLocale
      : locale;
    return NextResponse.redirect(
      buildConfirmRedirectUrl(getPublicOrigin(request), confirmedLocale),
      { headers: emailActionHeaders },
    );
  } catch (error) {
    captureException(error);
    return emailActionResponse(locale, "confirmation", "unavailable", 503);
  }
});
