/**
 * Route families for traversal accounting.
 *
 * The hard limiter buckets by exact pathname, which is why enumeration is free:
 * every new brand slug opens a FRESH bucket, so crawling 700 detail pages never
 * touches a single budget. A family is the bucket an attacker cannot escape by
 * changing the slug — `/brands/a` and `/brands/b` are the same family, so 700
 * slugs land in one counter.
 *
 * Edge-runtime safe: no imports, no Node built-ins. Anything added here must
 * stay pure string work, because `src/proxy.ts` calls it on every request.
 */

export const ROUTE_FAMILIES = [
  /** Directory index and taxonomy browse surfaces. */
  'directory:list',
  /** One brand detail document. The enumeration target. */
  'directory:detail',
  /** Query-driven lookups: `/brands?search=` and `/api/search`. */
  'directory:search',
  /** A `/brands/<x>` request whose slug cannot be a real slug. */
  'directory:invalid-slug',
  /** Sitemap surfaces: the cheapest way to obtain the full slug list. */
  'directory:sitemap',
  /**
   * The same-origin image proxy. Its own family on purpose: a brand page pulls
   * several images, and charging them to `directory:detail` would make a normal
   * reader look like an enumerator.
   */
  'directory:image',
  /** Everything else public: stories, trails, static pages. */
  'public:global-content',
] as const

export type RouteFamily = (typeof ROUTE_FAMILIES)[number]

/**
 * Duplicated from `src/proxy.ts`'s `SLUG_PATTERN` rather than imported: proxy.ts
 * imports the limiter, which imports this module, so importing back would close
 * a cycle. Ceiling: the two must be changed together. Upgrade path: move the
 * pattern into a shared edge-safe module once a second consumer needs it.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/

/**
 * Locale prefixes that must collapse before classification, or `/brands/x`,
 * `/zh-TW/brands/x` and `/en/brands/x` would be three separate buckets and an
 * enumerator would get three budgets for the same 700 pages.
 */
export const KNOWN_LOCALES = ['en', 'zh-TW'] as const

export function stripLocalePrefix(pathname: string): string {
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }

  return pathname
}

/** Query keys that turn a list surface into a search surface. */
const SEARCH_PARAM_KEYS = ['search', 'q']

export interface ClassifiedRoute {
  family: RouteFamily
  /**
   * Stable identifier for the thing being read, within its family. Distinct
   * resource counting is done over these, so a document request and its RSC
   * counterpart for one brand MUST produce the same value.
   */
  resourceId: string
}

function toSearchParams(
  searchParams: URLSearchParams | string | undefined,
): URLSearchParams {
  if (!searchParams) return new URLSearchParams()
  return typeof searchParams === 'string'
    ? new URLSearchParams(searchParams)
    : searchParams
}

function hasSearchTerm(params: URLSearchParams): boolean {
  return SEARCH_PARAM_KEYS.some((key) => (params.get(key) ?? '').trim() !== '')
}

export function classifyRoute(
  pathname: string,
  searchParams?: URLSearchParams | string,
): ClassifiedRoute {
  const path = stripLocalePrefix(pathname)
  const params = toSearchParams(searchParams)
  const segments = path.split('/').filter(Boolean)
  const head = segments.length > 0 ? segments[0] : ''

  // Images first: they end in an extension and would otherwise fall through to
  // the catch-all, or worse, be read as a detail path.
  if (head === 'i') {
    return { family: 'directory:image', resourceId: path }
  }

  if (path === '/sitemap.xml' || head === 'sitemap' || head.startsWith('sitemap')) {
    return { family: 'directory:sitemap', resourceId: path }
  }

  if (path === '/api/search') {
    const term = SEARCH_PARAM_KEYS.map((key) => params.get(key)?.trim() ?? '').find(
      (value) => value !== '',
    )
    return { family: 'directory:search', resourceId: `search:${term ?? ''}` }
  }

  if (head === 'brands') {
    if (segments.length === 1) {
      if (hasSearchTerm(params)) {
        const term = SEARCH_PARAM_KEYS.map(
          (key) => params.get(key)?.trim() ?? '',
        ).find((value) => value !== '')
        return { family: 'directory:search', resourceId: `search:${term ?? ''}` }
      }
      // Filter views are still the list surface. The filter combination is the
      // resource, so paging through every `?category=` view is counted.
      const filters = new URLSearchParams(params)
      filters.sort()
      const serialized = filters.toString()
      return {
        family: 'directory:list',
        resourceId: serialized ? `/brands?${serialized}` : '/brands',
      }
    }

    const slug = segments.length === 2 ? (segments[1] ?? '') : ''
    if (!slug || !SLUG_PATTERN.test(slug)) {
      // Deeper paths and malformed slugs alike: a 404 probe is exactly the
      // shape of a dictionary attack, and must not share the detail budget.
      return { family: 'directory:invalid-slug', resourceId: path }
    }

    return { family: 'directory:detail', resourceId: slug }
  }

  if (head === 'categories') {
    return { family: 'directory:list', resourceId: path }
  }

  return { family: 'public:global-content', resourceId: path }
}

export function routeFamily(
  pathname: string,
  searchParams?: URLSearchParams | string,
): RouteFamily {
  return classifyRoute(pathname, searchParams).family
}
