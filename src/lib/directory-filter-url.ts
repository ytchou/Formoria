type DirectoryFilterKey =
  | 'search'
  | 'category'
  | 'sub'
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

  if ('category' in updates && !updates.category) {
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
    price: null,
    verification: null,
  })
}
