'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Grid2X2,
  ListFilter,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Brand } from '@/lib/types'
import { surfaceCardStyles, SurfaceCard } from '@/components/ui/card'
import { DirectoryFilterToken } from './directory-filter-token'
import { BrandCard } from './brand-card'

export type ActiveDirectoryFilter = {
  id: string
  label: string
  value: string
  removeHref: string
  removeLabel: string
}

export type EmptyStateRecoveryAction = {
  kind: 'removeSearch' | 'clearFilters' | 'browseAll'
  href: string
}

type SearchEmptyStateProps = {
  query: string
  categoryLabel?: string
  activeFilters: ActiveDirectoryFilter[]
  recoveryActions: EmptyStateRecoveryAction[]
  recommendedBrands: Brand[]
  recommendationsHref: string
}

const RECOVERY_ICONS = {
  removeSearch: Search,
  clearFilters: ListFilter,
  browseAll: Grid2X2,
} satisfies Record<EmptyStateRecoveryAction['kind'], typeof Search>

export function SearchEmptyState({
  query,
  categoryLabel,
  activeFilters,
  recoveryActions,
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

        {recoveryActions.length > 0 ? (
          <div className="mt-6 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recoveryActions.map((action) => {
              const Icon = RECOVERY_ICONS[action.kind]
              return (
                <Link
                  key={action.kind}
                  href={action.href}
                  replace
                  scroll={false}
                  className={surfaceCardStyles({
                    interactive: true,
                    padding: 'sm',
                    className: 'group flex min-h-24 items-center gap-3 text-left',
                  })}
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block type-body-emphasis">{t(`actions.${action.kind}.title`)}</span>
                    <span className="mt-1 block type-caption">{t(`actions.${action.kind}.description`)}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        ) : null}
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
