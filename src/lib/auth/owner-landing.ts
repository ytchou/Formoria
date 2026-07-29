import { routing } from '@/i18n/routing'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'

/**
 * Routes that 404 while the owner-features kill switch is off. Matched as path
 * prefixes, so `/dashboard/brands/foo` and `/submit/owner/quick` are covered.
 */
const GATED_OWNER_PREFIXES = ['/dashboard', '/submit/owner']

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
export function isGatedOwnerPath(target: string): boolean {
  const suffixIndex = target.search(/[?#]/)
  const pathOnly = suffixIndex === -1 ? target : target.slice(0, suffixIndex)
  const path = stripLocalePrefix(pathOnly).replace(/\/+$/, '') || '/'
  return GATED_OWNER_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
}

/**
 * Where a signed-in user belongs when no explicit destination applies. Returns
 * an unlocalized path — call sites must still run it through `localizePath`.
 *
 * With owner features off the dashboard 404s, so land signed-in users home.
 */
export async function ownerLandingPath(): Promise<string> {
  return (await isOwnerFeaturesEnabled()) ? '/dashboard' : '/'
}

/**
 * Resolves the post-auth destination for a caller-supplied `next`. A `next`
 * aimed at a gated owner route while the flag is off (stale bookmark, old email
 * link, or a `post_auth_next` cookie written before the flip) would otherwise
 * complete sign-in on a hard 404, so it falls back to the landing path.
 *
 * Callers must have already run `next` through `isRelativeUrl` — this check is
 * additive to the open-redirect guard, not a replacement for it. Returns an
 * unlocalized path; call sites must still run it through `localizePath`.
 */
export async function resolvePostAuthPath(
  requestedNext: string | null | undefined
): Promise<string> {
  const ownerFeaturesEnabled = await isOwnerFeaturesEnabled()
  const landingPath = ownerFeaturesEnabled ? '/dashboard' : '/'
  if (!requestedNext) return landingPath
  if (!ownerFeaturesEnabled && isGatedOwnerPath(requestedNext)) return landingPath
  return requestedNext
}
