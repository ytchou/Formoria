import { localizePath, type AppLocale } from "@/i18n/locale-preference";
import { routes } from "@/lib/routes";

export function extractToken(url: URL): string | null {
  return url.searchParams.get("token");
}

export function buildConfirmRedirectUrl(
  origin: string,
  locale: AppLocale = "zh-TW",
): string {
  return `${origin}${localizePath(routes.home(), locale)}?subscribed=true`;
}
