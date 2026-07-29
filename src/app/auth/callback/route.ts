import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";
import { verifyClaimToken } from "@/lib/auth/claim-token";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { completeBrandClaim, getBrandById } from "@/lib/services/brands";
import { getProfileAdmin, updateProfileAdmin } from "@/lib/services/profiles";
import { enrollInMarketingEmails } from "@/lib/services/marketing-email-consent";
import { getPostHogClient } from "@/lib/posthog-server";
import {
  isAppLocale,
  localizePostAuthPath,
  LOCALE_COOKIE,
  resolveAuthenticatedLocale,
  type AppLocale,
} from "@/i18n/locale-preference";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const origin = await getRequestOrigin();

  // Post-auth intent is carried via short-lived cookies for the OAuth flow
  // (see signInWithGoogle), with query params as the fallback for the
  // email-link flows (sign-up confirmation / email+password claim).
  const cookieStore = await cookies();
  const next = cookieStore.get("post_auth_next")?.value ?? searchParams.get("next");
  const claimToken =
    cookieStore.get("post_auth_claim")?.value ?? searchParams.get("claim");
  const marketingEmailOptIn =
    cookieStore.get("post_auth_marketing_opt_in")?.value === "1";
  const rawIntendedLocale = cookieStore.get("post_auth_locale")?.value;
  const legacyMarketingLocale = cookieStore.get("post_auth_marketing_locale")?.value;
  const intendedLocale: AppLocale | null = isAppLocale(rawIntendedLocale)
    ? rawIntendedLocale
    : isAppLocale(legacyMarketingLocale)
      ? legacyMarketingLocale
      : null;
  cookieStore.delete("post_auth_next");
  cookieStore.delete("post_auth_claim");
  cookieStore.delete("post_auth_marketing_opt_in");
  cookieStore.delete("post_auth_marketing_locale");
  cookieStore.delete("post_auth_locale");

  if (!code && !claimToken) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=missing-code", origin)
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
        new URL("/auth/sign-in?error=expired-code", origin)
      );
    }
    userId = data.user?.id;
    userEmail = data.user?.email;

    try {
      const createdAt = data.user?.created_at;
      if (createdAt && Date.now() - new Date(createdAt).getTime() < 60_000) {
        isNewUser = true;
      }
    } catch {
      isNewUser = false;
    }
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

  if (userId && isNewUser && profile?.localePreference !== locale) {
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
      lifecycle: true,
    });
  }

  // Process claim token if present
  if (claimToken && userId && userEmail) {
    const claim = await verifyClaimToken(claimToken);

    if (!claim) {
      return NextResponse.redirect(
        new URL(localizePostAuthPath("/dashboard?error=invalid-claim", locale), origin)
      );
    }

    if (claim.email !== userEmail) {
      return NextResponse.redirect(
        new URL(localizePostAuthPath("/dashboard?error=email-mismatch", locale), origin)
      );
    }

    try {
      await completeBrandClaim({
        userId,
        brandId: claim.brandId,
        email: userEmail,
      });

      const brand = await getBrandById(claim.brandId);
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: userId,
        event: "brand_claim_completed",
        properties: {
          brand_id: claim.brandId,
          is_new_user: isNewUser,
        },
      });
      await posthog.flush();
      const url = new URL(
        localizePostAuthPath(`/dashboard/brands/${brand.slug}`, locale),
        origin,
      );
      if (isNewUser) {
        url.searchParams.set("is_new_user", "1");
      }
      return NextResponse.redirect(url);
    } catch (error) {
      const reason = error instanceof Error && error.message.includes('already manages a brand')
        ? 'owner-limit'
        : 'claim-failed'
      return NextResponse.redirect(
        new URL(localizePostAuthPath(`/dashboard?error=${reason}`, locale), origin)
      );
    }
  }

  if (userId) {
    const posthog = getPostHogClient();
    posthog.identify({
      distinctId: userId,
      properties: userEmail ? { email: userEmail } : {},
    });
    posthog.capture({
      distinctId: userId,
      event: "user_authenticated",
      properties: {
        is_new_user: isNewUser,
        has_claim_intent: Boolean(claimToken),
      },
    });
    await posthog.flush();
  }

  const redirectTo = next && isRelativeUrl(next) ? next : "/dashboard";
  const url = new URL(localizePostAuthPath(redirectTo, locale), origin);
  if (isNewUser) {
    url.searchParams.set("is_new_user", "1");
  }
  return NextResponse.redirect(url);
}
