import { localizePath } from "@/i18n/locale-preference";
import { routing } from "@/i18n/routing";
import { routes } from "@/lib/routes";

export type SignInContext = "favorites" | "settings";

const CONTEXT_PATHS: ReadonlyArray<[SignInContext, string]> = [
  ["favorites", routes.favorites()],
  ["settings", routes.settings()],
];

function isSameOrSubPath(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Which protected page sent the visitor to sign-in, read from `?next=`.
 *
 * `next` is written by `signInHref()` as a localized path, so it may carry an
 * `/en` prefix and a query or hash. Localizing to the default locale strips the
 * prefix (and turns anything that is not a same-origin path into `/`).
 */
export function signInContextFor(
  next: string | null | undefined,
): SignInContext | null {
  if (!next) return null;

  const [path = "/"] = localizePath(next, routing.defaultLocale).split(/[?#]/);
  const match = CONTEXT_PATHS.find(([, base]) => isSameOrSubPath(path, base));

  return match ? match[0] : null;
}
