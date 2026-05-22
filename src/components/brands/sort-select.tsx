'use client'

import {
  BRAND_SORT_CONFIG,
  type BrandSortOption,
} from '@/lib/pagination'
import { useFilterParams } from '@/hooks/use-filter-params'

export function SortSelect() {
  const { currentSort, setSort } = useFilterParams()

  return (
    <label className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
      排序方式
      <select
        value={currentSort}
        onChange={(e) => setSort(e.target.value as BrandSortOption)}
        className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring/20"
      >
        {(Object.entries(BRAND_SORT_CONFIG) as [BrandSortOption, (typeof BRAND_SORT_CONFIG)[BrandSortOption]][]).map(
          ([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          )
        )}
      </select>
    </label>
  )
}
