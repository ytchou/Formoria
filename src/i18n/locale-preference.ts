import { routing } from './routing'
import { routes } from '@/lib/routes'

export type AppLocale = (typeof routing.locales)[number]

export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale)
}

export function localizePath(pathname: string, locale: string): string {
  const safeLocale = isAppLocale(locale) ? locale : routing.defaultLocale
  const suffixIndex = pathname.search(/[?#]/)
  const pathOnly = suffixIndex === -1 ? pathname : pathname.slice(0, suffixIndex)
  const isSafePath = pathOnly.startsWith('/') && !pathOnly.startsWith('//')
  const safePath = isSafePath ? pathOnly : '/'
  const suffix = isSafePath && suffixIndex !== -1 ? pathname.slice(suffixIndex) : ''
  const unprefixedPath = safePath === '/en' || safePath === '/zh-TW'
    ? '/'
    : safePath.startsWith('/en/')
      ? safePath.slice(3)
      : safePath.startsWith('/zh-TW/')
        ? safePath.slice(6)
        : safePath
  const localizedPath = safeLocale === routing.defaultLocale
    ? unprefixedPath
    : `/en${unprefixedPath === '/' ? '' : unprefixedPath}`
  return `${localizedPath}${suffix}`
}

export function readOnlyStagingLocaleHref(
  pathname: string,
  locale: string,
  deploymentEnvironment: string | undefined,
): string | null {
  return deploymentEnvironment?.trim().toLowerCase() === 'staging'
    ? localizePath(pathname, locale)
    : null
}

export function resolveAuthenticatedLocale({
  isNewUser,
  profileLocale,
  intendedLocale,
}: {
  isNewUser: boolean
  profileLocale?: string | null
  intendedLocale?: string | null
}): AppLocale {
  if (!isNewUser && isAppLocale(profileLocale)) return profileLocale
  if (isAppLocale(intendedLocale)) return intendedLocale
  if (isAppLocale(profileLocale)) return profileLocale
  return routing.defaultLocale
}

export function signInHref(path: string, locale: string): string {
  return `${localizePath(routes.auth.signIn(), locale)}?next=${encodeURIComponent(localizePath(path, locale))}`
}

export function dateLocale(locale: string): string {
  return locale === 'en' ? 'en-US' : 'zh-TW'
}
