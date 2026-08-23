import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { withAuditScope } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isRelativeUrl } from "@/lib/auth/validations";
import { resolvePostAuthPath } from "@/lib/auth/owner-landing";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { getProfileAdmin, updateProfileAdmin } from "@/lib/services/profiles";
import { enrollInMarketingEmails } from "@/lib/services/marketing-email-consent";
import { getPostHogClient } from "@/lib/posthog-server";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { routing } from "@/i18n/routing";
import {
  isAppLocale,
  localizePath,
  LOCALE_COOKIE,
  resolveAuthenticatedLocale,
  type AppLocale,
} from "@/i18n/locale-preference";
import { isStagingRequest } from "@/lib/deployment-environment";
import { routes } from "@/lib/routes";

function isRecentlyCreated(createdAt: string | undefined): boolean {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() < 60_000;
}

export const GET = withAuditScope(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  // E2E-only fallback: Supabase's admin API has no way to mint a PKCE-compatible
  // confirmation link (generateLink accepts no code_challenge), so the signup
  // e2e journey can't complete via exchangeCodeForSession like a real emailed
  // link does. It confirms via verifyOtp's token_hash instead — gated so this
  // path can never be reached outside Playwright runs.
  const testTokenHash =
    process.env.PLAYWRIGHT_TEST === "true" ? searchParams.get("test_token_hash") : null;
  const origin = await getRequestOrigin();
  const staging = isStagingRequest(request.headers.get("host"));

  // Post-auth intent is carried via short-lived cookies for the OAuth flow
  // (see signInWithGoogle), with query params as the fallback for the
  // email-link flows (sign-up confirmation).
  const cookieStore = await cookies();
  const next = cookieStore.get("post_auth_next")?.value ?? searchParams.get("next");
  const marketingEmailOptIn =
    !staging && cookieStore.get("post_auth_marketing_opt_in")?.value === "1";
  const rawIntendedLocale = cookieStore.get("post_auth_locale")?.value;
  const legacyMarketingLocale = cookieStore.get("post_auth_marketing_locale")?.value;
  const intendedLocale: AppLocale | null = isAppLocale(rawIntendedLocale)
    ? rawIntendedLocale
    : isAppLocale(legacyMarketingLocale)
      ? legacyMarketingLocale
      : null;
  // Errors below are raised before the profile locale can be resolved, so fall
  // back through the post-auth intent cookie to the sticky NEXT_LOCALE cookie.
  const rawCookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const errorLocale: AppLocale =
    intendedLocale ?? (isAppLocale(rawCookieLocale) ? rawCookieLocale : routing.defaultLocale);
  cookieStore.delete("post_auth_next");
  cookieStore.delete("post_auth_marketing_opt_in");
  cookieStore.delete("post_auth_marketing_locale");
  cookieStore.delete("post_auth_locale");

  if (!code && !testTokenHash) {
    return NextResponse.redirect(
      new URL(localizePath(routes.auth.signIn({ error: "missing-code" }), errorLocale), origin)
    );
  }

  const supabase = await createClient();

  // Exchange code for session if present (email confirmation flow)
  let userId: string | undefined;
  let userEmail: string | undefined;
  let isNewUser = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(localizePath(routes.auth.signIn({ error: "expired-code" }), errorLocale), origin)
      );
    }
    userId = data.user?.id;
    userEmail = data.user?.email;
    isNewUser = isRecentlyCreated(data.user?.created_at);
  } else if (testTokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: testTokenHash,
      type: "signup",
    });
    if (error) {
      return NextResponse.redirect(
        new URL(localizePath(routes.auth.signIn({ error: "expired-code" }), errorLocale), origin)
      );
    }
    userId = data.user?.id;
    userEmail = data.user?.email;
    isNewUser = isRecentlyCreated(data.user?.created_at);
  } else {
    // Sign-in flow (no code) — get existing session
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id;
    userEmail = user?.email;
  }

  const profile = userId ? await getProfileAdmin(userId) : null;
  const locale = resolveAuthenticatedLocale({
    isNewUser,
    profileLocale: profile?.localePreference,
    intendedLocale,
  });

  if (!staging && userId && isNewUser && profile?.localePreference !== locale) {
    await updateProfileAdmin(userId, { localePreference: locale });
  }
  if (userId) {
    cookieStore.set(LOCALE_COOKIE, locale, {
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production" && process.env.PLAYWRIGHT_TEST !== "true",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  if (marketingEmailOptIn && userId && userEmail) {
    await enrollInMarketingEmails(createServiceClient(), {
      email: userEmail,
      userId,
      locale: intendedLocale ?? locale,
      source: "google_signup",
      newsletter: true,
    });
  }

  if (userId && !staging) {
    const posthog = getPostHogClient();
    posthog.identify({
      distinctId: userId,
      properties: userEmail ? { email: userEmail } : {},
    });
    posthog.capture({
      distinctId: userId,
      event: ANALYTICS_EVENTS.USER_AUTHENTICATED,
      properties: {
        is_new_user: isNewUser,
      },
    });
    await posthog.flush();
  }

  // Defers to the shared post-auth rule: a `next` aimed at a route DEV-1570
  // retired falls back to the landing path.
  const requestedNext = next && isRelativeUrl(next) ? next : null;
  const redirectTo = await resolvePostAuthPath(requestedNext);
  const url = new URL(localizePath(redirectTo, locale), origin);
  if (isNewUser) {
    url.searchParams.set("is_new_user", "1");
  } else if (!redirectTo.startsWith(routes.auth.resetPassword())) {
    // Recovery links exchange a code here too, but landing on the reset form is
    // not a login — the password hasn't been set yet. Marking it would inflate
    // `user_logged_in` with password-reset traffic.
    url.searchParams.set("auth_event", "login");
  }
  return NextResponse.redirect(url);
});
