import type { BrandFilters } from '@/lib/types'
import { parsePageParam, parseSortParam, type BrandSortOption } from '@/lib/pagination'

export type DirectorySearchParams = Record<string, string | string[] | undefined>

export type DirectoryViewFilters = Pick<
  BrandFilters,
  'search' | 'priceRanges' | 'verificationFilter'
> & {
  categorySlugs: string[]
  subcategorySlugs: string[]
}
function parseCommaParam(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((item) =>
    item
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

function parsePriceRanges(value: string | string[] | undefined): (1 | 2 | 3)[] {
  return parseCommaParam(value)
    .map(Number)
    .filter((price): price is 1 | 2 | 3 => price === 1 || price === 2 || price === 3)
}

function parseVerificationParam(
  value: string | string[] | undefined,
): NonNullable<BrandFilters['verificationFilter']> {
  return value === 'mit-verified' || value === 'mit-declared' || value === 'owned' || value === 'all'
    ? value
    : 'all'
}

export function parseDirectoryViewFilters(
  searchParams: DirectorySearchParams,
  validCategorySlugs: ReadonlySet<string>,
): { filters: DirectoryViewFilters; page: number; sort: BrandSortOption } {
  const categorySlugs = parseCommaParam(searchParams.category)
    .filter((slug) => validCategorySlugs.has(slug))
  const singleCategory = categorySlugs.length === 1 ? categorySlugs[0] ?? null : null

  return {
    page: parsePageParam(searchParams.page),
    sort: parseSortParam(searchParams.sort),
    filters: {
      search: typeof searchParams.search === 'string' ? searchParams.search.trim() : '',
      categorySlugs,
      subcategorySlugs: singleCategory ? parseCommaParam(searchParams.sub) : [],
      priceRanges: parsePriceRanges(searchParams.price),
      verificationFilter: parseVerificationParam(searchParams.verification),
    },
  }
}
