import type { Brand } from '@/lib/types'
import { BrandCard } from './brand-card'

interface RelatedBrandsProps {
  brands: Brand[]
  categoryName: string
}

export function RelatedBrands({ brands, categoryName }: RelatedBrandsProps) {
  if (brands.length === 0) return null

  return (
    <section className="mt-16 border-t border-border pt-8">
      <h2 className="mb-6 font-heading text-xl font-bold text-foreground">
        More in {categoryName}
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {brands.map((brand) => (
          <BrandCard key={brand.id} brand={brand} />
        ))}
      </div>
    </section>
  )
}
