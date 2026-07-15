import { getSiteUrl } from './site-url'

export type Locale = 'zh-TW' | 'en'

export type AlternatesResult = {
  canonical: string
  languages: Record<string, string>
}

function encodeServedPath(path: string): string {
  return encodeURI(path).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase())
}

/**
 * Build hreflang alternates and per-locale canonical for a given path.
 *
 * Routing convention:
 *   zh-TW (default) — prefix-free: ${base}${path}
 *   en               — under /en:  ${base}/en${path}
 *
 * @param path   Prefix-free public path, e.g. '/brands', '/brands/acme', '' or '/'
 * @param locale The locale of the current page (determines the self-referencing canonical)
 */
export function buildAlternates(
  path: string,
  locale: Locale,
  availableLocales: readonly Locale[] = ['zh-TW', 'en'],
): AlternatesResult {
  const base = getSiteUrl()

  // Normalize: home path ('' or '/') → no trailing slash; other paths start with '/'
  const normalizedPath = path === '' || path === '/'
    ? ''
    : encodeServedPath(`/${path.replace(/^\//, '')}`)

  const zhUrl = `${base}${normalizedPath}`
  const enUrl = `${base}/en${normalizedPath}`

  const canonical = locale === 'zh-TW' ? zhUrl : enUrl

  const languages: Record<string, string> = {}
  if (availableLocales.includes('zh-TW')) languages['zh-TW'] = zhUrl
  if (availableLocales.includes('en')) languages.en = enUrl
  const defaultUrl = languages['zh-TW'] ?? languages.en
  if (defaultUrl) languages['x-default'] = defaultUrl

  return { canonical, languages }
}
