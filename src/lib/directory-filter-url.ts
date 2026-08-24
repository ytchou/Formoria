/**
 * Query keys that carry a REFINEMENT of the result set rather than a position
 * in the taxonomy.
 *
 * One list, read by both predicates that answer "is this directory URL
 * refined?" — indexability (`lib/seo/directory-indexation.ts`) and route shape
 * (`components/navigation/category-tab-target.ts`). They were two hand-kept
 * arrays until `material` reached one and not the other, and a subcategory
 * chip then routed to a bare `/categories/<l1>/<l2>` that silently dropped the
 * material filter. Adding a facet now means adding it here, once.
 */
export const DIRECTORY_REFINEMENT_KEYS = [
  'search',
  'verification',
  'material',
] as const

/**
 * Sort is presentation: it reorders the same rows rather than narrowing them,
 * so indexation keeps it apart from the refinements above (a sorted page stays
 * indexable). Route shape counts it, because a taxonomy path cannot carry it.
 */
export const DIRECTORY_SORT_KEY = 'sort'

type DirectoryFilterKey =
  | (typeof DIRECTORY_REFINEMENT_KEYS)[number]
  | 'category'
  | 'sub'

type SearchParamsLike = { toString(): string }
type DirectoryFilterUpdates = Partial<
  Record<DirectoryFilterKey, string | null>
>

export function updateDirectoryUrl(
  pathname: string,
  searchParams: SearchParamsLike,
  updates: DirectoryFilterUpdates,
): string {
  const params = new URLSearchParams(searchParams.toString())

  // DEV-1540 retired the price facet. Strip it from any legacy URL as soon as
  // the user changes another directory control.
  params.delete('price')

  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }

  // `sub` is scoped to a single L1, so any change to `category` invalidates it.
  // `material` is deliberately NOT dropped here: it is an orthogonal axis —
  // a material means the same thing under every category — so clearing it would
  // discard a filter the user never touched.
  //
  // The exception is a patch that sets `sub` itself: the subcategory chips move
  // category and sub together through `buildCategoryTabTarget`, and deleting
  // the value the same call just set would make them dead links.
  const changesCategory = 'category' in updates
  const setsSubExplicitly = 'sub' in updates && Boolean(updates.sub)
  if (changesCategory && !setsSubExplicitly) {
    params.delete('sub')
  }

  params.delete('page')
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function clearDirectoryFilters(
  pathname: string,
  searchParams: SearchParamsLike,
  options: { includeSearch?: boolean } = {},
): string {
  return updateDirectoryUrl(pathname, searchParams, {
    ...(options.includeSearch ? { search: null } : {}),
    category: null,
    sub: null,
    material: null,
    verification: null,
  })
}
