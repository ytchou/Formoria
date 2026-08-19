type DirectoryFilterKey =
  | 'search'
  | 'category'
  | 'sub'
  | 'material'
  | 'price'
  | 'verification'

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
    price: null,
    verification: null,
  })
}
