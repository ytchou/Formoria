import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { ownerLandingPath } from "@/lib/auth/owner-landing";
import { localizePath } from "@/i18n/locale-preference";

export async function redirectIfAuthenticated(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const resolvedLocale = await getLocale();
  const locale = routing.locales.includes(
    resolvedLocale as (typeof routing.locales)[number]
  )
    ? resolvedLocale
    : routing.defaultLocale;

  redirect(localizePath(await ownerLandingPath(), locale));
}
