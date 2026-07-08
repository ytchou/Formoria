import { getTranslations } from 'next-intl/server'
import type { Brand } from '@/lib/types'
import { BrandCard } from './brand-card'

interface RelatedBrandsProps {
  brands: Brand[]
  categoryName: string
  categoryLabel?: string | null
}

export async function RelatedBrands({ brands }: RelatedBrandsProps) {
  if (brands.length === 0) return null

  const t = await getTranslations('brandDetail')

  return (
    <section className="mt-16 border-t border-border pt-8">
      <h2 className="mb-6 type-section-title-large">
        {t('relatedBrands.heading')}
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {brands.map((brand) => (
          <BrandCard key={brand.id} brand={brand} />
        ))}
      </div>
    </section>
  )
}
