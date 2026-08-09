import type { NextRequest } from "next/server";
import { signInWithGoogle } from "@/app/auth/actions";

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const claimToken = formData.get("claimToken");
  const next = formData.get("next");
  const locale = formData.get("locale");

  await signInWithGoogle(
    typeof claimToken === "string" ? claimToken : undefined,
    typeof next === "string" ? next : undefined,
    false,
    typeof locale === "string" ? locale : "zh-TW",
  );

  throw new Error("Google sign-in did not redirect");
}
