import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = formData.get("returnTo");
  const response = NextResponse.redirect(
    new URL(
      typeof returnTo === "string" && isRelativeUrl(returnTo) ? returnTo : "/",
      request.url,
    ),
    303,
  );
  const supabase = await createClient(response);

  await supabase.auth.signOut({ scope: "local" });

  return response;
}
