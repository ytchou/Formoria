import { parseCommaParam } from "@/lib/seo/directory-filters";

/**
 * /discover filter fields the search can fill in from the visitor's query.
 * The `inferred` param lists which of them were inferred rather than chosen,
 * so their chips can say so; `infer` is the one-time trigger for the parse.
 * Defined here (and re-exported by `lib/products/discover-search-params`)
 * because `updateDirectoryUrl` maintains the `inferred` list and
 * discover-search-params builds on `updateDirectoryUrl` — one direction only.
 */
export const INFERRED_FIELDS = ["category", "sub", "material"] as const;
export type InferredField = (typeof INFERRED_FIELDS)[number];
export const INFER_PARAM = "infer";
export const INFERRED_PARAM = "inferred";

/**
 * Query keys that carry a REFINEMENT of the result set rather than a position
 * in the taxonomy.
 *
 * One list, read by both predicates that answer "is this directory URL
 * refined?" — indexability (`lib/seo/directory-indexation.ts`) and route shape
 * (`components/navigation/category-tab-target.ts`). Adding a facet means
 * adding it here, once.
 */
export const DIRECTORY_REFINEMENT_KEYS = ["search", "material"] as const;

/**
 * Sort is presentation: it reorders the same rows rather than narrowing them,
 * so indexation keeps it apart from the refinements above (a sorted page stays
 * indexable). Route shape counts it, because a taxonomy path cannot carry it.
 */
export const DIRECTORY_SORT_KEY = "sort";

type DirectoryFilterKey =
  (typeof DIRECTORY_REFINEMENT_KEYS)[number] | "category" | "sub";

/**
 * Every key an update may set or clear: the filters, plus /discover's search
 * query and its `inferred` marker (cleared, never set, by clear-all).
 */
export type DirectoryClearKey =
  | DirectoryFilterKey
  | "q"
  | typeof INFERRED_PARAM;

type SearchParamsLike = { toString(): string };
export type DirectoryFilterUpdates = Partial<
  Record<DirectoryClearKey, string | null>
>;

export function updateDirectoryUrl(
  pathname: string,
  searchParams: SearchParamsLike,
  updates: DirectoryFilterUpdates,
): string {
  const params = new URLSearchParams(searchParams.toString());

  // Retired facets leave the URL as soon as the user changes another control.
  params.delete("price");
  params.delete("verification");

  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  // `sub` is scoped to a single L1, so any change to `category` invalidates it.
  // The exception is a patch that sets `sub` itself: the subcategory chips move
  // category and sub together through `buildCategoryTabTarget`, and deleting
  // the value the same call just set would make them dead links.
  const changesCategory = "category" in updates;
  const setsSubExplicitly = "sub" in updates && Boolean(updates.sub);
  if (changesCategory && !setsSubExplicitly) {
    params.delete("sub");
  }

  // A filter the visitor edits is no longer inferred (/discover's `inferred`
  // list); a category change takes the inferred sub with it.
  const inferred = params.get(INFERRED_PARAM);
  if (inferred !== null) {
    const touched = new Set<string>(Object.keys(updates));
    if (changesCategory) touched.add("sub");
    const remaining = parseCommaParam(inferred).filter(
      (field) =>
        !touched.has(field) &&
        (INFERRED_FIELDS as readonly string[]).includes(field),
    );
    if (remaining.length) params.set(INFERRED_PARAM, remaining.join(","));
    else params.delete(INFERRED_PARAM);
  }
  params.delete(INFER_PARAM);

  params.delete("page");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function clearDirectoryFilters(
  pathname: string,
  searchParams: SearchParamsLike,
  options: { includeSearch?: boolean } = {},
): string {
  return updateDirectoryUrl(pathname, searchParams, {
    ...(options.includeSearch ? { search: null } : {}),
    material: null,
    category: null,
    sub: null,
  });
}
