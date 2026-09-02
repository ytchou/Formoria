/**
 * Pure helpers for the /discover situation-search surface.
 *
 * No React, no I/O — only param parsing and URL construction.
 * Tested in __tests__/discover-search-params.test.ts.
 */

import { routes } from "@/lib/routes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscoverSort = "relevance" | "newest" | "alphabetical";

export type ParsedDiscoverQuery = {
  /** Trimmed search string, or null when the visitor is browsing. */
  query: string | null;
  /** Effective sort: defaults to "relevance" when a query is active, "newest" otherwise. */
  sort: DiscoverSort;
};

// ---------------------------------------------------------------------------
// parseDiscoverQuery
// ---------------------------------------------------------------------------

const VALID_SORTS = new Set<DiscoverSort>(["relevance", "newest", "alphabetical"]);

/**
 * Extract `q` and resolve `sort` from a raw search-params bag.
 *
 * Sort defaults to `"relevance"` when a query is present (search mode) and
 * `"newest"` otherwise (catalog mode), unless the visitor specified a sort
 * explicitly.
 */
export function parseDiscoverQuery(
  params: Record<string, string | string[] | undefined>,
): ParsedDiscoverQuery {
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const trimmed = rawQ?.trim() || null;
  const query = trimmed && trimmed.length > 0 ? trimmed : null;

  const rawSort = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const sortCandidate = rawSort?.trim() as DiscoverSort | undefined;
  const explicitSort =
    sortCandidate && VALID_SORTS.has(sortCandidate) ? sortCandidate : null;

  const sort: DiscoverSort = explicitSort ?? (query ? "relevance" : "newest");

  return { query, sort };
}

// ---------------------------------------------------------------------------
// discoverMetadataFor
// ---------------------------------------------------------------------------

type MetadataHints = {
  robots: { index: boolean; follow: boolean } | null;
  canonicalPath: string;
};

/**
 * Metadata decisions that depend on query presence.
 *
 * - `robots`: `{ index: false, follow: true }` when `q` is present (search
 *   results pages should not be indexed); `null` otherwise (use default).
 * - `canonicalPath`: the `/discover` path with category but never `q`.
 */
export function discoverMetadataFor(opts: {
  query: string | null;
  category: string | null;
}): MetadataHints {
  const canonicalPath = routes.discover({
    category: opts.category || undefined,
  });

  return {
    robots: opts.query ? { index: false, follow: true } : null,
    canonicalPath,
  };
}

// ---------------------------------------------------------------------------
// hrefWithoutQuery
// ---------------------------------------------------------------------------

/**
 * Build a URL that drops `q` (and `page`) while keeping all other params.
 * Used by the query filter token's dismiss link.
 */
export function hrefWithoutQuery(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("q");
  next.delete("page");
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// ---------------------------------------------------------------------------
// sortOptionsFor
// ---------------------------------------------------------------------------

/**
 * The sort option keys to render, in display order.
 * `"relevance"` only makes sense when a query is active.
 */
export function sortOptionsFor(hasQuery: boolean): DiscoverSort[] {
  return hasQuery
    ? ["relevance", "newest", "alphabetical"]
    : ["newest", "alphabetical"];
}
