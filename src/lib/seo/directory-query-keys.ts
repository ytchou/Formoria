/**
 * The canonical directory query vocabulary: every key that changes WHICH
 * directory resource a URL names.
 *
 * `parseDirectoryViewFilters` in `./directory-filters.ts` is the canonical
 * parser, but it imports the taxonomy ontology and so cannot be pulled into an
 * edge request. This module carries the key list alone, with no imports at all,
 * so `src/lib/security/route-family.ts` and `src/proxy.ts` can derive their
 * sets from the same source instead of restating them.
 *
 * Edge-runtime safe by construction: keep it dependency-free. Anything imported
 * here is imported by the proxy on every single request.
 *
 * The drift guard lives in `./directory-query-keys.test.ts`, which records the
 * keys `parseDirectoryViewFilters` actually reads and compares them to this
 * list.
 */

/** The `search` key, split out because it is the one unbounded facet. */
export const DIRECTORY_SEARCH_QUERY_KEY = 'search'

/** Every query key the directory parser reads, `search` included. */
export const DIRECTORY_QUERY_KEYS = [
  'category',
  'sub',
  'material',
  'verification',
  'sort',
  'page',
  DIRECTORY_SEARCH_QUERY_KEY,
] as const

export type DirectoryQueryKey = (typeof DIRECTORY_QUERY_KEYS)[number]

/**
 * The bounded facets: the canonical list minus free-text search. A filter view
 * is one of a finite set of renderings; `search` is unbounded, which is why
 * every consumer that cares about cacheability or resource identity uses this
 * list rather than the full one.
 */
export const DIRECTORY_FILTER_QUERY_KEYS: readonly DirectoryQueryKey[] =
  DIRECTORY_QUERY_KEYS.filter((key) => key !== DIRECTORY_SEARCH_QUERY_KEY)
