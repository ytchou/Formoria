import { routing } from './routing'

export type AppLocale = (typeof routing.locales)[number]

export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale)
}

export function localizePath(pathname: string, locale: AppLocale): string {
  const safePath = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/'
  const unprefixedPath = safePath === '/en' || safePath === '/zh-TW'
    ? '/'
    : safePath.startsWith('/en/')
      ? safePath.slice(3)
      : safePath.startsWith('/zh-TW/')
        ? safePath.slice(6)
        : safePath
  return locale === routing.defaultLocale
    ? unprefixedPath
    : `/en${unprefixedPath === '/' ? '' : unprefixedPath}`
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
      .filter(({ language, quality }) => Boolean(language) && Number.isFinite(quality))
      .sort((a, b) => b.quality - a.quality)
      .at(0)?.language
    return preferred?.startsWith('zh') ? 'zh-TW' : 'en'
  }
  return country?.toUpperCase() === 'TW' ? 'zh-TW' : 'en'
}
