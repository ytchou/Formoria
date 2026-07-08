'use client'

import { useTranslations } from 'next-intl'
import {
  BRAND_SORT_CONFIG,
  type BrandSortOption,
} from '@/lib/pagination'
import { useFilterParams } from '@/hooks/use-filter-params'

export function SortSelect() {
  const t = useTranslations('brands')
  const { currentSort, setSort } = useFilterParams()

  return (
    <label className="inline-flex items-center gap-2 type-metadata">
      {t('sortLabel')}
      <select
        value={currentSort}
        onChange={(e) => setSort(e.target.value as BrandSortOption)}
        className="rounded-lg border border-border bg-background px-3 py-1.5 type-body-emphasis transition-colors hover:border-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring/20"
      >
        {(Object.keys(BRAND_SORT_CONFIG) as BrandSortOption[]).map((key) => (
          <option key={key} value={key}>
            {t(`sort.${key}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
