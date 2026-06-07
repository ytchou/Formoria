import { getSiteUrl } from './site-url'

export type Locale = 'zh-TW' | 'en'

export type AlternatesResult = {
  canonical: string
  languages: Record<string, string>
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
export function buildAlternates(path: string, locale: Locale): AlternatesResult {
  const base = getSiteUrl()

  // Normalize: home path ('' or '/') → no trailing slash; other paths start with '/'
  const normalizedPath = path === '' || path === '/' ? '' : `/${path.replace(/^\//, '')}`

  const zhUrl = `${base}${normalizedPath}`
  const enUrl = `${base}/en${normalizedPath}`

  const canonical = locale === 'zh-TW' ? zhUrl : enUrl

  return {
    canonical,
    languages: {
      'zh-TW': zhUrl,
      en: enUrl,
      'x-default': zhUrl,
    },
  }
}
