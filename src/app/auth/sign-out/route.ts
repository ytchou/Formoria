import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRelativeUrl } from "@/lib/auth/validations";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const returnTo = formData.get("returnTo");
  const supabase = await createClient();

  await supabase.auth.signOut({ scope: "local" });

  return NextResponse.redirect(
    new URL(
      typeof returnTo === "string" && isRelativeUrl(returnTo) ? returnTo : "/",
      request.url,
    ),
    303,
  );
}
