/**
 * Route families for traversal accounting.
 *
 * The hard limiter buckets by exact pathname, which is why enumeration is free:
 * every new brand slug opens a FRESH bucket, so crawling 700 detail pages never
 * touches a single budget. A family is the bucket an attacker cannot escape by
 * changing the slug — `/brands/a` and `/brands/b` are the same family, so 700
 * slugs land in one counter.
 *
 * Edge-runtime safe. Both imports are inert: `src/i18n/routing.ts` is a
 * `defineRouting` object literal, and `src/lib/seo/directory-query-keys.ts` is
 * a dependency-free string list. Neither has Node built-ins nor a back-edge
 * into this module or into `src/proxy.ts`, so neither closes an import cycle
 * nor pulls anything the edge runtime lacks. Anything else added here must stay
 * pure string work, because `src/proxy.ts` calls it on every request.
 */

import { routing } from '@/i18n/routing'
import { DIRECTORY_FILTER_QUERY_KEYS } from '@/lib/seo/directory-query-keys'

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
  /**
   * Admin, account and API surfaces. NOT scored by the enumeration
   * ladder: enumeration protection is about public content, and an admin
   * working the moderation queue legitimately opens 40+ distinct `/admin/...`
   * paths in ten minutes. Scoring them against the directory thresholds would
   * poison the very distribution the thresholds are meant to be calibrated
   * from, and would challenge or 429 staff the moment the mode is flipped.
   */
  'internal:non-public',
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
 *
 * Derived from `routing.locales`, never hand-listed. A hand-listed copy is the
 * one that silently misses a newly added locale, after which
 * `/<new-locale>/brands/<slug>` falls past the `brands` test into the
 * `public:global-content` catch-all and hands out a fresh, uncounted budget
 * covering the whole directory -- the exact hole this module exists to close.
 */
const KNOWN_LOCALES: readonly string[] = routing.locales

export function stripLocalePrefix(pathname: string): string {
  for (const locale of KNOWN_LOCALES) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }

  return pathname
}

/** Query keys that turn a list surface into a search surface. */
const SEARCH_PARAM_KEYS = ['search', 'q']

/**
 * The only query keys that make a list surface a DIFFERENT resource.
 *
 * Derived from `DIRECTORY_FILTER_QUERY_KEYS`, the edge-safe copy of the
 * vocabulary `parseDirectoryViewFilters` reads. That parser is canonical but
 * cannot be imported here, because it pulls the taxonomy ontology into every
 * edge request; the key list module carries the names alone and is the single
 * source the proxy's cacheable-key set is built from as well.
 *
 * An allow-list and not a deny-list on purpose. Next appends `?_rsc=<hash>` to
 * every RSC navigation and prefetch, so a deny-list that forgot one key would
 * make one click on `/brands` count as two distinct resources and break the
 * `markOnce` dedup at the same time; the same is true of every `utm_source`,
 * `fbclid` and `gclid` a shared link carries.
 */
const RESOURCE_DEFINING_PARAM_KEYS: ReadonlySet<string> = new Set(DIRECTORY_FILTER_QUERY_KEYS)

/**
 * Route families the enumeration ladder does not score. See
 * `internal:non-public`.
 */
const UNACCOUNTED_FAMILIES: ReadonlySet<RouteFamily> = new Set<RouteFamily>([
  'internal:non-public',
])

/**
 * First path segments that are never public content. `api` is included here,
 * but `/api/search` is classified before this set is consulted, so the one
 * public API surface keeps its own family.
 */
const NON_PUBLIC_HEADS = new Set([
  'admin',
  'api',
  'auth',
  // Retired with the owner dashboard (DEV-1570) but still in the URL space:
  // stale prefetched links, bookmarks and scanners keep hitting it. It stays
  // non-public so those 404s are never scored on the enumeration ladder, whose
  // thresholds are calibrated from directory traffic only.
  'dashboard',
  'favorites',
  'settings',
])

/** True when the ladder should score this family. */
export function isAccountedFamily(family: RouteFamily): boolean {
  return !UNACCOUNTED_FAMILIES.has(family)
}

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

  if (head === 'discover' && segments.length === 1 && hasSearchTerm(params)) {
    const term = SEARCH_PARAM_KEYS.map((key) => params.get(key)?.trim() ?? '').find(
      (value) => value !== '',
    )
    return { family: 'directory:search', resourceId: `product-search:${term ?? ''}` }
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
      // resource, so paging through every `?category=` view is counted -- but
      // only the keys that genuinely select a different set of brands.
      const filters = new URLSearchParams()
      for (const [key, value] of params) {
        if (RESOURCE_DEFINING_PARAM_KEYS.has(key)) filters.append(key, value)
      }
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

  if (head === 'style') {
    return { family: 'public:global-content', resourceId: path }
  }

  if (NON_PUBLIC_HEADS.has(head)) {
    return { family: 'internal:non-public', resourceId: path }
  }

  return { family: 'public:global-content', resourceId: path }
}

export function routeFamily(
  pathname: string,
  searchParams?: URLSearchParams | string,
): RouteFamily {
  return classifyRoute(pathname, searchParams).family
}

/**
 * Whether a visitor identity cookie should be minted on this request.
 *
 * Decided from the REQUEST, because middleware runs BEFORE the route handler
 * and therefore cannot see a `cache-control` the handler has not set yet.
 *
 * `directory:image` is the case that forced this. A cold visitor whose HTML
 * came from the Cloudflare edge cache fires N parallel uncookied `/i/`
 * requests; minting on each one produces N different identities, N
 * `visitor_identity_rotated` events for a single genuine first visit, and a
 * `Set-Cookie` on responses a CDN would otherwise cache for a year -- CDNs
 * bypass cache for `Set-Cookie` responses, so the `immutable` year is lost for
 * every cold visitor. An image request needs no identity of its own.
 *
 * `internal:non-public` is excluded for the same reason it is unaccounted:
 * nothing downstream reads an identity for those surfaces.
 */
export function shouldMintVisitorIdentity(
  pathname: string,
  searchParams?: URLSearchParams | string,
): boolean {
  const family = routeFamily(pathname, searchParams)
  return family !== 'directory:image' && family !== 'internal:non-public'
}
