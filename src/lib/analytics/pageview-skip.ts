// Targeted suppression of one GA page_view, plus the single scrub that defines what a
// GA "page path" is. A client component that rewrites the URL with
// history.replaceState after the server render (DiscoverUrlSync writing inferred
// filters into /discover) registers the rewrite as { from, to }. When the router then
// reports `to`, GA skips it: the search submit already logged its page_view.
//
// Both ends are scrubbed page paths (pathname + scrubbed query), so a rewrite that only
// changes stripped params (q, infer, inferred) never registers a skip. The skip is
// targeted, not a blind "skip the next one": any page path other than `from` or `to`
// discards it, so a stale skip cannot swallow an unrelated later navigation.
// Module-level is safe: the setter and the GA effect are client-side singletons.
// Nothing here runs on a timer.

import { INFER_PARAM, INFERRED_PARAM } from '@/lib/directory-filter-url'

// Params carrying raw user-typed text. Search terms ARE captured deliberately as of
// DEV-1408 — but only as the `search_term` property on PostHog's search events, where the
// value is guarded and truncated at the call site. A query smuggled through a URL gets none
// of that: GA derives `dl`/`dr` from whatever we hand it, so these must still be stripped
// before they reach `page_location`/`page_referrer`. `q` (the /discover query) is
// stripped too — it previously leaked into page_location. Filter/sort/page params
// (category/sub/material, …) are deliberately kept: they are a closed vocabulary and
// carry no user text.
const FREE_TEXT_PARAMS = ['search', 'q']

// Internal inference markers, not free text, but noise in GA reports.
const INTERNAL_PARAMS = [INFER_PARAM, INFERRED_PARAM]

/** Query string (no leading "?") with free-text and internal params removed. */
export function toAnalyticsQuery(search: string): string {
  const params = new URLSearchParams(search)
  for (const key of FREE_TEXT_PARAMS) params.delete(key)
  for (const key of INTERNAL_PARAMS) params.delete(key)
  return params.toString()
}

/** The page path GA reports: pathname plus the scrubbed query, if any. */
export function toAnalyticsPagePath(pathname: string, search: string): string {
  const query = toAnalyticsQuery(search)
  return query ? `${pathname}?${query}` : pathname
}

let pending: { from: string; to: string } | null = null

/** Register a client-side URL rewrite from one scrubbed page path to another. */
export function skipPageviewFor(from: string, to: string): void {
  pending = { from, to }
}

/**
 * GA side. Returns true (and clears the skip) when `pagePath` is the registered
 * rewrite target. A path equal to `from` keeps the skip pending — the router has not
 * caught up with the rewrite yet. Any other path clears the stale skip.
 */
export function shouldSkipPageview(pagePath: string): boolean {
  if (!pending) return false
  if (pagePath === pending.to) {
    pending = null
    return true
  }
  if (pagePath !== pending.from) pending = null
  return false
}
