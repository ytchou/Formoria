import { getSiteUrl } from './site-url'

export type Locale = 'zh-TW' | 'en'

export type AlternatesResult = {
  canonical: string
  languages: Record<string, string>
}

/**
 * Percent-encode a path to the shape Next actually serves — **idempotently**.
 *
 * Callers now build paths through `@/lib/routes`, which escapes each parameter
 * exactly once. A bare `encodeURI` would then escape those `%` signs a second
 * time (`%e9…` → `%25e9…`), so a CJK brand slug would canonicalize to a URL
 * that resolves to nothing. Splitting on the escapes already present and
 * encoding only the gaps makes this safe to apply to a raw path and to an
 * already-encoded one alike.
 *
 * The one ambiguity this accepts: a literal `%` followed by two hex digits in a
 * raw path is read as an existing escape. No route parameter in this app can
 * contain one, and the alternative — double-escaping every real slug — is the
 * far more expensive mistake.
 */
function encodeServedPath(path: string): string {
  return path
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part, index) => (index % 2 === 1 ? part : encodeURI(part)))
    .join('')
    .replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase())
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
