import { getTranslations } from "next-intl/server";
import {
  ACCENT,
  FONT_SIZE_BODY,
  FONT_SIZE_TITLE,
  FONT_STACK,
  GROUND,
  INK,
  LINE_HEIGHT_BODY,
  LINE_HEIGHT_TITLE,
  SPACE_GUTTER,
  SPACE_SECTION,
  SPACE_STACK,
} from "@emails/styles";
import { escapeHtml } from "@emails/utils";
import { localizePath, type AppLocale } from "@/i18n/locale-preference";
import { routes } from "@/lib/routes";

export const emailActionHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export function emailActionLocale(url: URL): AppLocale {
  return url.searchParams.get("locale") === "en" ? "en" : "zh-TW";
}

export async function emailActionResponse(
  locale: AppLocale,
  action: "confirmation" | "newsletterUnsubscribe" | "ownerUnsubscribe",
  outcome: "missing" | "invalid" | "unavailable" | "success",
  status: number,
): Promise<Response> {
  const t = await getTranslations({ locale, namespace: "emailActions" });
  const heading = t(`${outcome}Heading`);
  const message = t(
    outcome === "success"
      ? action === "ownerUnsubscribe"
        ? "ownerUnsubscribeSuccess"
        : "newsletterUnsubscribeSuccess"
      : outcome === "invalid" && action === "confirmation"
        ? "confirmationInvalid"
        : `${outcome}Body`,
  );
  const settings = outcome === "success" && action === "ownerUnsubscribe";
  const href = localizePath(
    settings ? routes.settings() : routes.home(),
    locale,
  );
  const label = t(
    settings
      ? "manageNewsletter"
      : outcome === "invalid" && action === "confirmation"
        ? "subscribeAgain"
        : "home",
  );

  return new Response(
    `<!doctype html><html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)} · Formoria</title>
<style>
:root{--prose-measure:48rem}
*{box-sizing:border-box}
body{margin:0;background:${GROUND};color:${INK};font-family:${FONT_STACK};font-size:${FONT_SIZE_BODY};line-height:${LINE_HEIGHT_BODY}}
main{max-width:var(--prose-measure);margin:auto;padding:${SPACE_SECTION} ${SPACE_GUTTER};overflow-wrap:anywhere}
header{margin-bottom:${SPACE_STACK}}
h1{font-size:${FONT_SIZE_TITLE};line-height:${LINE_HEIGHT_TITLE};margin:0 0 ${SPACE_GUTTER}}
p{margin:0 0 ${SPACE_STACK}}
a{display:inline-flex;align-items:center;min-height:${SPACE_SECTION};color:${ACCENT};text-underline-offset:.2em}
</style></head><body><main><header>Formoria</header>
<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p>
<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>
</main></body></html>`,
    {
      status,
      headers: {
        ...emailActionHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}
