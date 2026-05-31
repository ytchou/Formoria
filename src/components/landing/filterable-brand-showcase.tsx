'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { BrandCard } from '@/components/brands/brand-card'
import type { Brand } from '@/lib/types/brand'

interface Category {
  slug: string
  name: string
  nameZh: string | null
}

interface FilterableBrandShowcaseProps {
  brands: Brand[]
  categories: Category[]
}

export default function FilterableBrandShowcase({
  brands,
  categories,
}: FilterableBrandShowcaseProps) {
  const t = useTranslations('landing.showcase')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filteredBrands = useMemo(() => {
    if (!selectedCategory) return brands
    return brands.filter((b) =>
      b.tags.some((t) => t.slug === selectedCategory),
    )
  }, [brands, selectedCategory])

  const displayBrands = filteredBrands.slice(0, 4)

  const selectedCategoryLabel = selectedCategory
    ? (categories.find((c) => c.slug === selectedCategory)?.nameZh ??
      categories.find((c) => c.slug === selectedCategory)?.name)
    : null

  const ctaText = selectedCategoryLabel
    ? t('browseAllCategory', { category: selectedCategoryLabel })
    : t('browseAll')

  const ctaHref = selectedCategory
    ? `/brands?category=${selectedCategory}`
    : '/brands'

  return (
    <section>
      <h2 className="font-heading text-2xl font-bold">{t('heading')}</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            !selectedCategory
              ? 'border border-transparent bg-primary text-primary-foreground'
              : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          }`}
        >
          {t('all')}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => setSelectedCategory(cat.slug)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              selectedCategory === cat.slug
                ? 'border border-transparent bg-primary text-primary-foreground'
                : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {cat.nameZh ?? cat.name}
          </button>
        ))}
      </div>

      {displayBrands.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {displayBrands.map((brand, i) => (
            <BrandCard key={brand.id} brand={brand} position={i} />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          {t('emptyCategory')}
        </p>
      )}

      {filteredBrands.length > 0 && (
        <div className="mt-6">
          <Link href={ctaHref} className="font-medium text-primary">
            {ctaText}
          </Link>
        </div>
      )}
    </section>
  )
}
