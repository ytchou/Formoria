export const DEFAULT_PAGE_SIZE = 12

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
  if (raw === undefined || Array.isArray(raw)) return 'random'
  if (raw in BRAND_SORT_CONFIG) return raw as BrandSortOption
  return 'random'
}
