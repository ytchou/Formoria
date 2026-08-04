import { buildAlternates, type AlternatesResult, type Locale } from './alternates'

type DirectoryCanonicalOptions = {
  locale: Locale
  categorySlug?: string | null
  page?: number
}

function appendDirectoryQuery(
  url: string,
  categorySlug: string | null | undefined,
  page: number,
): string {
  const params = new URLSearchParams()
  if (categorySlug) params.set('category', categorySlug)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${url}?${query}` : url
}

export function buildDirectoryCanonicals({
  locale,
  categorySlug,
  page = 1,
}: DirectoryCanonicalOptions): AlternatesResult {
  const { canonical, languages } = buildAlternates('/brands', locale)
  const append = (url: string) => appendDirectoryQuery(url, categorySlug, page)

  return {
    canonical: append(canonical),
    languages: Object.fromEntries(
      Object.entries(languages).map(([language, url]) => [language, append(url)]),
    ),
  }
}
