'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Brand } from '@/lib/types'
import { filterBrandsByTags, parseTagSlugsFromParam } from '@/lib/filter-brands'
import { BrandCard } from './brand-card'

interface BrandGridProps {
  brands: Brand[]
}

/**
 * Reads the ?tags= search param on the client and filters the brand list
 * without a full page reload. The parent server component fetches all approved
 * brands and passes them down; filtering is done here in JS.
 */
export function BrandGrid({ brands }: BrandGridProps) {
  const searchParams = useSearchParams()

  const filteredBrands = useMemo(() => {
    const selectedSlugs = parseTagSlugsFromParam(searchParams.get('tags'))
    return filterBrandsByTags(brands, selectedSlugs)
  }, [brands, searchParams])

  if (filteredBrands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-base font-semibold text-foreground">No brands found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting or clearing your filters.
        </p>
      </div>
    )
  }

  return (
    <div
      className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Brand directory"
      role="list"
    >
      {filteredBrands.map((brand) => (
        <div key={brand.id} role="listitem">
          <BrandCard brand={brand} />
        </div>
      ))}
    </div>
  )
}
