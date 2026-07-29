import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { isOwnerFeaturesEnabled } from "@/lib/services/app-settings";
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

  // With owner features off the dashboard 404s, so land signed-in users home.
  const destination = (await isOwnerFeaturesEnabled()) ? '/dashboard' : '/';
  redirect(localizePath(destination, locale));
}
