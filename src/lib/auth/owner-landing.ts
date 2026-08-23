import { routing } from '@/i18n/routing'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import { routes } from '@/lib/routes'

/**
 * Routes that 404 while the owner-features kill switch is off. Matched as path
 * prefixes, so `/submit/owner/quick` is covered.
 */
const GATED_OWNER_PREFIXES = [routes.submit.owner()]

/**
 * The owner dashboard, parked by DEV-1570. Its `routes.dashboard.*` builders
 * were deleted with it, so the prefix is a literal here. Separate from
 * `GATED_OWNER_PREFIXES` because that set is only consulted while the
 * owner-features flag is off, and this route 404s either way.
 */
const RETIRED_PREFIXES = ['/dashboard']

function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}

/**
 * True when an unlocalized-or-localized relative target points at a surface the
 * owner-features flag hides. Query string and hash are ignored.
 */
function isGatedOwnerPath(target: string): boolean {
  return matchesPrefix(target, GATED_OWNER_PREFIXES)
}

/**
 * True when the target points at a surface DEV-1570 deleted outright. Unlike
 * `isGatedOwnerPath` this does not depend on the owner-features flag: the route
 * is gone from the router, so honoring such a `next` is always a 404.
 */
function isRetiredPath(target: string): boolean {
  return matchesPrefix(target, RETIRED_PREFIXES)
}

function matchesPrefix(target: string, prefixes: readonly string[]): boolean {
  const suffixIndex = target.search(/[?#]/)
  const pathOnly = suffixIndex === -1 ? target : target.slice(0, suffixIndex)
  const path = stripLocalePrefix(pathOnly).replace(/\/+$/, '') || '/'
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * Where a signed-in user belongs when no explicit destination applies. Returns
 * an unlocalized path — call sites must still run it through `localizePath`.
 *
 * Always home: the owner dashboard it used to point at was removed (DEV-1570),
 * and no other surface is a general-purpose signed-in landing.
 */
export async function ownerLandingPath(): Promise<string> {
  return '/'
}

/**
 * Resolves the post-auth destination for a caller-supplied `next`: the request
 * wins, otherwise the landing path. A `next` aimed at a gated owner route while
 * the flag is off, or at a route DEV-1570 retired (stale bookmark, old
 * claim-invite email link, or a `post_auth_next` cookie written before the
 * deploy), would otherwise complete sign-in on a hard 404, so it falls back to
 * the landing path too.
 *
 * Callers must have already run `next` through `isRelativeUrl` — this check is
 * additive to the open-redirect guard, not a replacement for it. Returns an
 * unlocalized path; call sites must still run it through `localizePath`.
 */
export async function resolvePostAuthPath(
  requestedNext: string | null | undefined
): Promise<string> {
  const landingPath = await ownerLandingPath()
  if (!requestedNext) return landingPath
  if (isRetiredPath(requestedNext)) return landingPath
  if (!(await isOwnerFeaturesEnabled()) && isGatedOwnerPath(requestedNext)) {
    return landingPath
  }
  return requestedNext
}
