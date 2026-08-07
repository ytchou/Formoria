export const DEFAULT_PAGE_SIZE = 12
const MAX_POSTGRES_INTEGER = 2_147_483_647
const MAX_PUBLIC_PAGE = Math.floor(MAX_POSTGRES_INTEGER / DEFAULT_PAGE_SIZE) + 1

export type BrandSortOption = 'random' | 'name' | 'newest' | 'year'

export const BRAND_SORT_CONFIG: Record<
  BrandSortOption,
  { column: string; ascending: boolean; label: string }
> = {
  random: { column: '', ascending: true, label: 'random' },
  name: { column: 'name', ascending: true, label: 'A-Z' },
  newest: { column: 'created_at', ascending: false, label: 'newest' },
  year: { column: 'founding_year', ascending: false, label: 'year' },
}

/**
 * The page numbers (and ellipses) a pagination control should render.
 *
 * Lives here rather than beside one component because two surfaces now paginate
 * with different navigation mechanics — `/brands` uses `next/link`, the Creative
 * Expo exhibitor list uses buttons because its route must read no dynamic API —
 * and the *shape* of the control has to stay identical between them.
 */
export function getPageRange(
  currentPage: number,
  totalPages: number
): (number | 'ellipsis')[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: (number | 'ellipsis')[] = []

  if (currentPage <= 3) {
    pages.push(1, 2, 3, 4, 'ellipsis', totalPages)
  } else if (currentPage >= totalPages - 2) {
    pages.push(1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    pages.push(1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages)
  }

  return pages
}

export function parsePageParam(
  raw: string | string[] | undefined
): number {
  if (raw === undefined || Array.isArray(raw)) return 1
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PUBLIC_PAGE) return 1
  return parsed
}

export function parseSortParam(
  raw: string | string[] | undefined
): BrandSortOption {
  if (raw === undefined || Array.isArray(raw)) return 'random'
  if (raw in BRAND_SORT_CONFIG) return raw as BrandSortOption
  return 'random'
}
