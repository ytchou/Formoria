'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Brand } from '@/lib/types'
import { SurfaceCard } from '@/components/ui/card'
import { DirectoryFilterToken } from './directory-filter-token'
import { BrandCard } from './brand-card'

export type ActiveDirectoryFilter = {
  id: string
  label: string
  value: string
  removeHref: string
  removeLabel: string
}

type SearchEmptyStateProps = {
  query: string
  categoryLabel?: string
  activeFilters: ActiveDirectoryFilter[]
  clearAllHref: string
  recommendedBrands: Brand[]
  recommendationsHref: string
}

export function SearchEmptyState({
  query,
  categoryLabel,
  activeFilters,
  clearAllHref,
  recommendedBrands,
  recommendationsHref,
}: SearchEmptyStateProps) {
  const t = useTranslations('search.emptyState')
  const hasNonSearchFilters = activeFilters.some((filter) => filter.id !== 'search')
  const notice = query && categoryLabel
    ? t('noticeSearchCategory', { query, category: categoryLabel })
    : query && hasNonSearchFilters
      ? t('noticeSearchFilters', { query })
      : query
        ? t('noticeSearch', { query })
        : hasNonSearchFilters
          ? t('noticeFilters')
          : t('noticeAll')

  return (
    <div data-empty className="space-y-8">
      {activeFilters.length > 0 ? (
        <SurfaceCard padding="sm" className="flex flex-wrap items-center gap-2">
          <span className="mr-1 type-body-emphasis">{t('currentConditions')}</span>
          {activeFilters.map((filter) => (
            <DirectoryFilterToken
              key={filter.id}
              href={filter.removeHref}
              label={filter.label}
              removeLabel={filter.removeLabel}
              value={filter.value}
              variant="chip"
            />
          ))}
          <Link href={clearAllHref} replace scroll={false} className="ml-auto text-sm font-medium text-primary hover:underline">
            {t('clearAll')}
          </Link>
        </SurfaceCard>
      ) : null}

      <SurfaceCard tone="info" padding="sm" role="status" className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p className="type-card-description text-current">{notice}</p>
      </SurfaceCard>

      <section className="flex flex-col items-center py-2 text-center">
        <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
          <div className="absolute inset-3 rotate-6 rounded-xl border border-border bg-card shadow-card" />
          <div className="absolute inset-5 -rotate-3 rounded-xl border border-border bg-background" />
          <Search className="relative size-12 text-foreground" strokeWidth={1.75} />
          <SlidersHorizontal className="absolute bottom-1 right-0 size-6 text-filter-active" />
        </div>
        <h2 className="mt-3 type-empty-title">{t('title')}</h2>
        <p className="mt-2 max-w-xl type-card-description">{t('description')}</p>

      </section>

      {recommendedBrands.length > 0 ? (
        <section className="border-t border-border pt-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="type-section-title">{t('recommendations')}</h2>
            <Link href={recommendationsHref} className="inline-flex min-h-12 items-center gap-1 font-medium hover:text-primary">
              {t('viewAll')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {recommendedBrands.map((brand, index) => (
              <BrandCard
                key={brand.id}
                brand={brand}
                position={index}
                priority={index < 2}
                variant="recommendation"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
