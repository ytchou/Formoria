'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'

interface SearchEmptyStateProps {
  query: string
  hasActiveFilters: boolean
  categories: { productType: string; count: number }[]
  featuredBrands: {
    id: string
    name: string
    slug: string
    heroImageUrl: string | null
    category: string
  }[]
  onClearFilters: () => void
}

export function SearchEmptyState({
  query,
  hasActiveFilters,
  categories,
  featuredBrands,
  onClearFilters,
}: SearchEmptyStateProps) {
  const t = useTranslations('search')

  return (
    <div data-empty className="flex flex-col items-center py-16">
      {/* Icon */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/50">
        <Search className="h-12 w-12 text-muted-foreground" />
      </div>

      {/* Heading */}
      <h2 className="mt-4 text-center text-lg font-semibold text-foreground">
        {hasActiveFilters
          ? t('emptyState.withFiltersTitle', { query })
          : t('emptyState.title', { query })}
      </h2>

      {/* Subtitle */}
      <p className="mt-1 text-center text-sm text-muted-foreground">
        {hasActiveFilters
          ? t('emptyState.withFiltersDescription')
          : t('emptyState.description')}
      </p>

      {/* Clear filters button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-3 cursor-pointer rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('emptyState.clearFilters')}
        </button>
      )}

      {/* Browse by Category */}
      {categories.length > 0 && (
        <div className="mt-8 w-full">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('emptyState.browseCategories')}
          </p>
          <div className="scrollbar-hide mt-3 flex justify-center gap-2 overflow-x-auto flex-nowrap">
            {categories.map(({ productType }) => (
              <Link
                key={productType}
                href={`?category=${encodeURIComponent(productType)}`}
                className="whitespace-nowrap rounded-full border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {productType}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Featured Brands */}
      {featuredBrands.length > 0 && (
        <div className="mt-8 w-full">
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('emptyState.featuredBrands')}
          </p>
          <div className="scrollbar-hide mt-3 flex justify-center gap-3 overflow-x-auto flex-nowrap">
            {featuredBrands.map((brand) => (
              <Link
                key={brand.id}
                href={`/brands/${brand.slug}`}
                className="w-32 flex-shrink-0 overflow-hidden rounded-lg bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {brand.heroImageUrl ? (
                  <Image
                    src={brand.heroImageUrl}
                    alt={brand.name}
                    width={128}
                    height={96}
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div className="aspect-[4/3] w-full bg-muted" />
                )}
                <p className="truncate px-2 pt-1.5 text-sm font-medium text-foreground">
                  {brand.name}
                </p>
                <p className="truncate px-2 pb-2 text-xs text-muted-foreground">
                  {brand.category}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
