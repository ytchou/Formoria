import { buildAlternates, type AlternatesResult, type Locale } from './alternates'

type DirectoryCanonicalOptions = {
  locale: Locale
  categorySlug?: string | null
  subcategorySlug?: string | null
  page?: number
  /** Recognized query facets to retain for a noindex self-canonical. */
  preserveFacets?: DirectoryCanonicalFacets
}

export type DirectoryCanonicalFacets = {
  search?: unknown
  price?: unknown
  verification?: unknown
  category?: unknown
  sub?: unknown
  material?: unknown
  sort?: unknown
}

function queryValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => queryValue(item))
      .filter((item): item is string => item !== null)
    return values.length > 0 ? values.join(',') : null
  }
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function appendDirectoryQuery(
  url: string,
  page: number,
  facets?: DirectoryCanonicalFacets,
): string {
  const params = new URLSearchParams()
  const recognizedFacets: Array<[string, unknown]> = [
    ['search', facets?.search],
    ['price', facets?.price],
    ['verification', facets?.verification],
    ['category', facets?.category],
    ['sub', facets?.sub],
    ['material', facets?.material],
    ['sort', facets?.sort],
  ]
  for (const [key, value] of recognizedFacets) {
    const serialized = queryValue(value)
    if (serialized) params.set(key, serialized)
  }
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${url}?${query}` : url
}

export function buildDirectoryCanonicals({
  locale,
  categorySlug,
  subcategorySlug,
  page = 1,
  preserveFacets,
}: DirectoryCanonicalOptions): AlternatesResult {
  const directoryPath = categorySlug
    ? `/categories/${categorySlug}${subcategorySlug ? `/${subcategorySlug}` : ''}`
    : '/brands'
  const { canonical, languages } = buildAlternates(directoryPath, locale)
  const append = (url: string) => appendDirectoryQuery(url, page, preserveFacets)

  return {
    canonical: append(canonical),
    languages: Object.fromEntries(
      Object.entries(languages).map(([language, url]) => [language, append(url)]),
    ),
  }
}
