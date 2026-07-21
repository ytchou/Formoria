'use client'

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import {
  BRAND_SORT_CONFIG,
  type BrandSortOption,
} from '@/lib/pagination'
import { trackDirectorySortChanged } from '@/lib/analytics'
import { useFilterParams } from '@/hooks/use-filter-params'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

export function SortSelect() {
  const t = useTranslations('brands')
  const { currentSort, setSort } = useFilterParams()
  const prevSortRef = useRef(currentSort)

  return (
    <Label className="inline-flex items-center gap-2 type-metadata">
      {t('sortLabel')}
      <NativeSelect
        value={currentSort}
        onChange={(e) => {
          const newSort = e.target.value as BrandSortOption
          trackDirectorySortChanged(newSort, prevSortRef.current)
          prevSortRef.current = newSort
          setSort(newSort)
        }}
        className="w-fit"
        data-ph-no-autocapture
      >
        {(Object.keys(BRAND_SORT_CONFIG) as BrandSortOption[]).map((key) => (
          <option key={key} value={key}>
            {t(`sort.${key}`)}
          </option>
        ))}
      </NativeSelect>
    </Label>
  )
}
