import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { Brand } from '@/lib/types'
import { BrandCard } from './brand-card'
import { RelatedBrandsTracker } from './related-brands-tracker'

interface RelatedBrandsProps {
  brands: Brand[]
  category: string | null
  categoryName: string
  categoryLabel?: string | null
  count: number
  currentBrandSlug?: string
}

export async function RelatedBrands({
  brands,
  category,
  categoryLabel,
  categoryName,
  count,
  currentBrandSlug,
}: RelatedBrandsProps) {
  if (!category || brands.length === 0) return null

  const t = await getTranslations('brandDetail')
  const displayLabel = categoryLabel ?? categoryName

  return (
    <RelatedBrandsTracker sourceBrandSlug={currentBrandSlug ?? ''} count={count}>
      <section className="mt-16 border-t border-border pt-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 className="type-section-title-large">
              {t('relatedBrands.heading', { category: displayLabel })}
            </h2>
            <p className="type-card-description">
              {t('relatedBrands.subtext', { count })}
            </p>
          </div>
          <Link
            href={`/brands?category=${encodeURIComponent(category)}`}
            className="group inline-flex min-h-12 items-center gap-1.5 self-start type-body-emphasis text-primary transition-colors hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            {t('relatedBrands.viewAll')}
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {brands.map((brand, index) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              variant="recommendation"
              sourceBrandSlug={currentBrandSlug}
              position={index}
            />
          ))}
        </div>
      </section>
    </RelatedBrandsTracker>
  )
}
