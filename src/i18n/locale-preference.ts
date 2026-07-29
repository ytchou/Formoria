import { routing } from './routing'

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

export function localizePostAuthPath(path: string, locale: string): string {
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === '/auth' || pathname.startsWith('/auth/')
    ? path
    : localizePath(path, locale)
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
  return `/auth/sign-in?next=${encodeURIComponent(localizePath(path, locale))}`
}

export function dateLocale(locale: string): string {
  return locale === 'en' ? 'en-US' : 'zh-TW'
}

export function resolveInitialLocale({
  cookieLocale,
  acceptLanguage,
  country,
}: {
  cookieLocale?: string | null
  acceptLanguage?: string | null
  country?: string | null
}): AppLocale {
  if (isAppLocale(cookieLocale)) return cookieLocale
  if (acceptLanguage?.trim()) {
    const preferred = acceptLanguage
      .toLowerCase()
      .split(',')
      .map((entry) => {
        const [language, ...parameters] = entry.trim().split(';')
        const quality = parameters
          .map((parameter) => parameter.trim())
          .find((parameter) => parameter.startsWith('q='))
        return { language, quality: quality ? Number(quality.slice(2)) : 1 }
      })
      .filter(({ language, quality }) =>
        Boolean(language) && Number.isFinite(quality) && quality > 0 && quality <= 1,
      )
      .sort((a, b) => b.quality - a.quality)
      .map(({ language }) => language)
      .find((language) => language === 'en' || language.startsWith('en-') || language.startsWith('zh'))
    if (preferred?.startsWith('zh')) return 'zh-TW'
    if (preferred) return 'en'
  }
  if (country) return country.toUpperCase() === 'TW' ? 'zh-TW' : 'en'
  return routing.defaultLocale
}
