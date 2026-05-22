import type { Brand } from '@/lib/types'
import { BrandCard } from './brand-card'

interface BrandGridProps {
  brands: Brand[]
}

/**
 * Server component: renders a responsive grid of brand cards.
 * Filtering and pagination are handled server-side — this component
 * receives only the brands to display.
 */
export function BrandGrid({ brands }: BrandGridProps) {
  if (brands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-base font-semibold text-foreground">找不到品牌</p>
        <p className="mt-1 text-sm text-muted-foreground">
          請嘗試調整或清除篩選條件。
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
      {brands.map((brand, index) => (
        <div key={brand.id} role="listitem">
          <BrandCard brand={brand} position={index} />
        </div>
      ))}
    </div>
  )
}
