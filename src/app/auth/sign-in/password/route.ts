import { NextResponse, type NextRequest } from "next/server";
import { signIn } from "@/app/auth/actions";
import { isAppLocale, localizePath } from "@/i18n/locale-preference";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const result = await signIn({}, formData);
  const requestedLocale = formData.get("locale");
  const locale =
    typeof requestedLocale === "string" && isAppLocale(requestedLocale)
      ? requestedLocale
      : "zh-TW";
  const url = new URL(localizePath("/auth/sign-in", locale), request.url);
  url.searchParams.set(
    "error",
    result.error ? "invalid-credentials" : "default",
  );

  return NextResponse.redirect(url, 303);
}
