export const DEFAULT_PAGE_SIZE = 12

export type BrandSortOption = 'name' | 'newest' | 'year'

export const BRAND_SORT_CONFIG: Record<
  BrandSortOption,
  { column: string; ascending: boolean; label: string }
> = {
  name: { column: 'name', ascending: true, label: 'A-Z' },
  newest: { column: 'created_at', ascending: false, label: 'Newest' },
  year: { column: 'founding_year', ascending: false, label: 'Founding Year' },
}

export function parsePageParam(
  raw: string | string[] | undefined
): number {
  if (raw === undefined || Array.isArray(raw)) return 1
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.floor(parsed)
}

export function parseSortParam(
  raw: string | string[] | undefined
): BrandSortOption {
  if (raw === undefined || Array.isArray(raw)) return 'name'
  if (raw in BRAND_SORT_CONFIG) return raw as BrandSortOption
  return 'name'
}
