import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=missing-code", request.url)
    );
  }

  const supabase = await createClient();
  await supabase.auth.exchangeCodeForSession(code);

  const redirectTo = next && isRelativeUrl(next) ? next : "/dashboard";

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
