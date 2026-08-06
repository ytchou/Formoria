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
