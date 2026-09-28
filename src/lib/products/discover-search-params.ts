/**
 * Pure helpers for the /discover situation-search surface.
 *
 * No React, no I/O — only param parsing and URL construction.
 * Tested in __tests__/discover-search-params.test.ts.
 */

import { routes } from "@/lib/routes";
import { parseCommaParam } from "@/lib/seo/directory-filters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscoverSort = "relevance" | "newest" | "alphabetical";

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Filter fields the search can fill in from the visitor's query. The
 * `inferred` URL param lists which of them were inferred rather than chosen,
 * so their chips can say so. `infer=1` is the one-time trigger for the parse.
 */
export const INFERRED_FIELDS = ["category", "sub", "material"] as const;

export type InferredField = (typeof INFERRED_FIELDS)[number];

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
 * from `q` leave with it; filters the visitor chose stay.
 */
export function hrefWithoutQuery(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const next = new URLSearchParams(searchParams.toString());
  for (const field of parseInferredFields(next)) next.delete(field);
  next.delete("q");
  next.delete("page");
  next.delete("inferred");
  next.delete("infer");
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// ---------------------------------------------------------------------------
// parseInferredFields
// ---------------------------------------------------------------------------

/**
 * Read the `inferred` param into known fields, in `INFERRED_FIELDS` order.
 * Unknown and duplicate entries are ignored.
 */
export function parseInferredFields(
  params: { get(name: string): string | null } | RawSearchParams,
): InferredField[] {
  const raw =
    typeof params.get === "function"
      ? (params as { get(name: string): string | null }).get("inferred") ??
        undefined
      : (params as RawSearchParams).inferred;
  const listed = new Set(parseCommaParam(raw));
  return INFERRED_FIELDS.filter((field) => listed.has(field));
}

// ---------------------------------------------------------------------------
// buildDiscoverSyncQuery
// ---------------------------------------------------------------------------

/** Params this builder owns; everything else passes through unchanged. */
const SYNC_OWNED_KEYS = new Set([
  "q",
  "category",
  "sub",
  "material",
  "inferred",
  "infer",
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
 * rewrite. `infer` is always dropped. `page` is dropped only alongside
 * `infer`: a fresh search starts on page 1, but paging within a search must
 * keep its position.
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
  const first = (key: string): string | undefined => {
    const value = rawParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const next = new URLSearchParams();
  const q = first("q");
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
  if (inferred.length) next.set("inferred", inferred.join(","));

  const sort = first("sort");
  if (sort) next.set("sort", sort);
  const page = first("page");
  if (page && first("infer") === undefined) next.set("page", page);

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
