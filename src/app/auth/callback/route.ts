import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";
import { verifyClaimToken } from "@/lib/auth/claim-token";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { completeBrandClaim, getBrandById } from "@/lib/services/brands";
import { getProfileAdmin } from "@/lib/services/profiles";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  // Post-auth intent is carried via short-lived cookies for the OAuth flow
  // (see signInWithGoogle), with query params as the fallback for the
  // email-link flows (sign-up confirmation / email+password claim).
  const cookieStore = await cookies();
  const next = cookieStore.get("post_auth_next")?.value ?? searchParams.get("next");
  const claimToken =
    cookieStore.get("post_auth_claim")?.value ?? searchParams.get("claim");
  cookieStore.delete("post_auth_next");
  cookieStore.delete("post_auth_claim");

  if (!code && !claimToken) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=missing-code", await getRequestOrigin())
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
        new URL("/auth/sign-in?error=expired-code", await getRequestOrigin())
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

  // Process claim token if present
  if (claimToken && userId && userEmail) {
    const claim = await verifyClaimToken(claimToken);

    if (!claim) {
      return NextResponse.redirect(
        new URL("/dashboard?error=invalid-claim", await getRequestOrigin())
      );
    }

    if (claim.email !== userEmail) {
      return NextResponse.redirect(
        new URL("/dashboard?error=email-mismatch", await getRequestOrigin())
      );
    }

    try {
      await completeBrandClaim({
        userId,
        brandId: claim.brandId,
        email: userEmail,
      });

      const brand = await getBrandById(claim.brandId);
      const url = new URL(`/dashboard?brand=${brand.slug}`, await getRequestOrigin());
      if (isNewUser) {
        url.searchParams.set("is_new_user", "1");
      }
      return NextResponse.redirect(url);
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard?error=claim-failed", await getRequestOrigin())
      );
    }
  }

  // Sync locale preference cookie on login
  if (userId) {
    const profile = await getProfileAdmin(userId);
    if (profile?.localePreference) {
      cookieStore.set("NEXT_LOCALE", profile.localePreference, {
        sameSite: "lax",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      });
    }
  }

  const redirectTo = next && isRelativeUrl(next) ? next : "/dashboard";
  const url = new URL(redirectTo, await getRequestOrigin());
  if (isNewUser) {
    url.searchParams.set("is_new_user", "1");
  }
  return NextResponse.redirect(url);
}
