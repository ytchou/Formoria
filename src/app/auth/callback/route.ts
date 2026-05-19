import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";
import { verifyClaimToken } from "@/lib/auth/claim-token";
import { completeBrandClaim, getBrandById } from "@/lib/services/brands";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const claimToken = searchParams.get("claim");

  if (!code && !claimToken) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=missing-code", request.url)
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
        new URL("/auth/sign-in?error=expired-code", request.url)
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
        new URL("/dashboard?error=invalid-claim", request.url)
      );
    }

    if (claim.email !== userEmail) {
      return NextResponse.redirect(
        new URL("/dashboard?error=email-mismatch", request.url)
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
        new URL(`/dashboard/brands/${brand.slug}`, request.url)
      );
    } catch {
      return NextResponse.redirect(
        new URL("/dashboard?error=claim-failed", request.url)
      );
    }
  }

  const redirectTo = next && isRelativeUrl(next) ? next : "/dashboard";
  return NextResponse.redirect(new URL(redirectTo, request.url));
}
