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
import { trackCtaClicked } from '@/lib/analytics'
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
  recommendedBrands: Brand[]
  recommendationsHref: string
}

export function SearchEmptyState({
  query,
  categoryLabel,
  activeFilters,
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
      <SurfaceCard
        tone="info"
        padding="sm"
        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div role="status" className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="type-card-description text-current">{notice}</p>
        </div>
        {query ? (
          <Link
            href={`/submit/recommend?name=${encodeURIComponent(query)}`}
            data-ph-no-autocapture
            onClick={() =>
              trackCtaClicked('recommend_brand', 'empty_state', '/submit/recommend', '/brands')
            }
            className="inline-flex min-h-12 shrink-0 items-center gap-1 self-start type-link sm:self-auto"
          >
            {t('actions.recommendBrand.title')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
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
            <Link
              href={recommendationsHref}
              data-ph-no-autocapture
              onClick={() => trackCtaClicked('view_all', 'empty_state', recommendationsHref, '/brands')}
              className="inline-flex min-h-12 items-center gap-1 font-medium hover:text-primary"
            >
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
                variant="recommendation"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
