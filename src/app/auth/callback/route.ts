import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";
import { verifyClaimToken } from "@/lib/auth/claim-token";
import { getSiteUrl } from "@/lib/auth/site-url";
import { completeBrandClaim, getBrandById } from "@/lib/services/brands";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const claimToken = searchParams.get("claim");

  if (!code && !claimToken) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=missing-code", getSiteUrl())
    );
  }

  const supabase = await createClient();

  // Exchange code for session if present (email confirmation flow)
  let userId: string | undefined;
  let userEmail: string | undefined;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL("/auth/sign-in?error=expired-code", getSiteUrl())
      );
    }
    userId = data.user?.id;
    userEmail = data.user?.email;
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
        new URL("/dashboard?error=invalid-claim", getSiteUrl())
      );
    }

    if (claim.email !== userEmail) {
      return NextResponse.redirect(
        new URL("/dashboard?error=email-mismatch", getSiteUrl())
      );
    }

    try {
      await completeBrandClaim({
        userId,
        brandId: claim.brandId,
        email: userEmail,
      });

      const brand = await getBrandById(claim.brandId);
      return NextResponse.redirect(
        new URL(`/dashboard/brands/${brand.slug}`, getSiteUrl())
      );
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard?error=claim-failed", getSiteUrl())
      );
    }
  }

  const redirectTo = next && isRelativeUrl(next) ? next : "/dashboard";
  return NextResponse.redirect(new URL(redirectTo, getSiteUrl()));
}
