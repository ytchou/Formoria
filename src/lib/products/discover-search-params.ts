/**
 * Pure helpers for the /discover situation-search surface.
 *
 * No React, no I/O — only param parsing and URL construction.
 * Tested in __tests__/discover-search-params.test.ts.
 */

import { routes } from "@/lib/routes";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import {
  INFERRED_FIELDS,
  INFERRED_PARAM,
  INFER_PARAM,
  updateDirectoryUrl,
  type DirectoryClearKey,
  type InferredField,
} from "@/lib/directory-filter-url";

export { INFERRED_FIELDS, INFERRED_PARAM, INFER_PARAM, type InferredField };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscoverSort = "relevance" | "newest" | "alphabetical";

type RawParamValue = string | string[] | undefined;
type RawSearchParams = Record<string, RawParamValue>;
type SearchParamsReader = { get(name: string): string | null };

export type ParsedDiscoverQuery = {
  /** Trimmed search string, or null when the visitor is browsing. */
  query: string | null;
  /** Effective sort: defaults to "relevance" when a query is active, "newest" otherwise. */
  sort: DiscoverSort;
};

// ---------------------------------------------------------------------------
// firstValue / hasInferParam
// ---------------------------------------------------------------------------

/** The first value of a raw search param (Next.js gives repeats as arrays). */
export function firstValue(value: RawParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether the URL carries the `infer` trigger, whatever its value. A present
 * `infer` means a fresh search-form submit: the URL sync renders to strip it,
 * and the sync drops `page` with it. Only `infer=1` gates the intent parse.
 */
export function hasInferParam(params: RawSearchParams): boolean {
  return params[INFER_PARAM] !== undefined;
}

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
  params: RawSearchParams,
): ParsedDiscoverQuery {
  const query = firstValue(params.q)?.trim() || null;

  const rawSort = firstValue(params.sort);
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
 * Material slugs with ≥15 products across applicable L1 categories, counted
 * on 2026-09-14. Below-threshold pages get noindex to avoid thin-content
 * indexation. Update when product counts shift materially.
 */
export const QUALIFYING_MATERIAL_SLUGS: ReadonlySet<string> = new Set([
  'ceramic',
  'wood',
  'textile',
  'glass',
  'metal',
  'wool',
  'leather',
  'paper',
  'stone',
]);

/**
 * Metadata decisions that depend on query and filter presence.
 *
 * - `robots`: `{ index: false, follow: true }` when `q` is present, when a
 *   below-threshold material is active, or when multiple materials are
 *   selected; `null` otherwise (use default).
 * - `canonicalPath`: the `/discover` path with category and a single
 *   qualifying material, but never `q`.
 */
export function discoverMetadataFor(opts: {
  query: string | null;
  category: string | null;
  materials?: string[];
}): MetadataHints {
  const mats = opts.materials ?? [];
  const singleQualifying =
    mats.length === 1 && QUALIFYING_MATERIAL_SLUGS.has(mats[0]!)
      ? mats[0]!
      : null;

  const canonicalPath = routes.discover({
    category: opts.category || undefined,
    ...(singleQualifying ? { material: singleQualifying } : {}),
  });

  const hasSubThresholdMaterial = mats.some(
    (m) => !QUALIFYING_MATERIAL_SLUGS.has(m),
  );
  const shouldNoindex =
    !!opts.query || hasSubThresholdMaterial || mats.length > 1;

  return {
    robots: shouldNoindex ? { index: false, follow: true } : null,
    canonicalPath,
  };
}

// ---------------------------------------------------------------------------
// hrefWithoutQuery
// ---------------------------------------------------------------------------

/**
 * Build a URL that drops `q` (and `page`) while keeping all other params.
 * Used by the query filter token's dismiss link. Filters that were inferred
 * from `q` leave with it; filters the visitor chose stay — except a `sub`
 * under an inferred category, which `updateDirectoryUrl` cascades away
 * because `sub` is scoped to its category.
 */
export function hrefWithoutQuery(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const updates: Partial<Record<DirectoryClearKey, null>> = {
    q: null,
    [INFERRED_PARAM]: null,
  };
  const inferred = parseInferredFields(
    searchParams.get(INFERRED_PARAM) ?? undefined,
  );
  for (const field of inferred) updates[field] = null;
  return updateDirectoryUrl(pathname, searchParams, updates);
}

// ---------------------------------------------------------------------------
// discoverClearAllKeys
// ---------------------------------------------------------------------------

/**
 * Keys /discover's clear-all removes on top of `sub` and `material`. In search
 * mode (a non-blank `q`) that is also the category, the `inferred` marker and
 * `q` itself, so the visitor lands on an unfiltered page. Browse mode keeps
 * the category: there it is the page's position, not a filter.
 */
export function discoverClearAllKeys(
  searchParams: SearchParamsReader,
): DirectoryClearKey[] {
  const { query } = parseDiscoverQuery({
    q: searchParams.get("q") ?? undefined,
  });
  return query ? ["category", INFERRED_PARAM, "q"] : [];
}

// ---------------------------------------------------------------------------
// parseInferredFields
// ---------------------------------------------------------------------------

/**
 * Read a raw `inferred` param value into known fields, in `INFERRED_FIELDS`
 * order. Unknown and duplicate entries are ignored.
 */
export function parseInferredFields(raw: RawParamValue): InferredField[] {
  const listed = new Set(parseCommaParam(raw));
  return INFERRED_FIELDS.filter((field) => listed.has(field));
}

// ---------------------------------------------------------------------------
// buildDiscoverSyncQuery
// ---------------------------------------------------------------------------

/** Params this builder owns; everything else passes through unchanged. */
const SYNC_OWNED_KEYS = new Set([
  "src",
  "q",
  "category",
  "sub",
  "material",
  INFERRED_PARAM,
  INFER_PARAM,
  "sort",
  "page",
]);

/**
 * The query string the /discover URL should carry once the effective filters
 * (URL filters plus applied inference) are known. Returns `?…`, or `""` when
 * nothing remains.
 *
 * Keys are written in a fixed order, so the output for a URL that already
 * matches is identical to that URL's query string and a caller can skip the
 * rewrite. `infer` is always dropped. `page` is dropped only when `infer` is
 * present (see `hasInferParam`): a fresh search starts on page 1, but paging
 * within a search must keep its position.
 */
export function buildDiscoverSyncQuery(
  rawParams: RawSearchParams,
  effective: {
    category: string | null;
    subcategories: string[];
    materials: string[];
  },
  inferredFields: readonly InferredField[],
): string {
  const next = new URLSearchParams();
  const q = firstValue(rawParams.q);
  if (q) next.set("q", q);
  if (effective.category) next.set("category", effective.category);
  if (effective.subcategories.length) {
    next.set("sub", effective.subcategories.join(","));
  }
  if (effective.materials.length) {
    next.set("material", effective.materials.join(","));
  }

  const inferred = INFERRED_FIELDS.filter(
    (field) => inferredFields.includes(field) && next.has(field),
  );
  if (inferred.length) next.set(INFERRED_PARAM, inferred.join(","));

  const sort = firstValue(rawParams.sort);
  if (sort) next.set("sort", sort);
  const page = firstValue(rawParams.page);
  if (page && !hasInferParam(rawParams)) next.set("page", page);

  for (const [key, value] of Object.entries(rawParams)) {
    if (SYNC_OWNED_KEYS.has(key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      next.append(key, item);
    }
  }

  const qs = next.toString();
  return qs ? `?${qs}` : "";
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

export function parseDiscoverSource(params: RawSearchParams): "nav" | "hero" | "discover_page" {
  const source = firstValue(params.src);
  return source === "nav" || source === "hero" ? source : "discover_page";
}
