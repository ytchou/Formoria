'use client'

import { useTranslations } from 'next-intl'
import {
  BRAND_SORT_CONFIG,
  type BrandSortOption,
} from '@/lib/pagination'
import { useFilterParams } from '@/hooks/use-filter-params'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

export function SortSelect() {
  const t = useTranslations('brands')
  const { currentSort, setSort } = useFilterParams()

  return (
    <Label className="inline-flex items-center gap-2 type-metadata">
      {t('sortLabel')}
      <NativeSelect
        value={currentSort}
        onChange={(e) => setSort(e.target.value as BrandSortOption)}
        className="w-fit"
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
