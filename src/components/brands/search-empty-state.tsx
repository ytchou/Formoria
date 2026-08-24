'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowRight, Search, SlidersHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { PublicBrandCard } from '@/lib/brands/contracts'
import { Grid } from '@/components/ui/grid'
import { trackCtaClicked } from '@/lib/analytics'
import { clearDirectoryFilters } from '@/lib/directory-filter-url'
import { BrandCard } from './brand-card'
import { routes } from '@/lib/routes'

export type ActiveDirectoryFilter = {
  id: string
  label: string
  value: string
  removeHref: string
  removeLabel: string
}

type SearchEmptyStateProps = {
  activeFilters: ActiveDirectoryFilter[]
  recommendedBrands: PublicBrandCard[]
  recommendationsHref: string
}

export function SearchEmptyState({
  activeFilters,
  recommendedBrands,
  recommendationsHref,
}: SearchEmptyStateProps) {
  const t = useTranslations('search.emptyState')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hasNonSearchFilters = activeFilters.some((filter) => filter.id !== 'search')
  /*
   * The way out, built the same way the sidebar's own clear-all builds it
   * (`MobileClearAll`): drop every facet, KEEP the search. Two different exits
   * because they cost the reader different things — clearing filters keeps what
   * they asked for and widens where it is looked for, while browsing everything
   * abandons the question. Offering only "start over" would hide the cheaper of
   * the two.
   *
   * `usePathname` comes from `next/navigation`, NOT `@/i18n/navigation`, because
   * the links in this file are plain `next/link`. The i18n hook strips the
   * locale segment for the i18n `Link` to add back; pairing it with a plain
   * link would send an `/en` reader to the zh-TW path.
   */
  const clearFiltersHref = clearDirectoryFilters(pathname, searchParams)

  return (
    <div data-empty className="space-y-8">
      <section className="flex flex-col items-center py-2 text-center">
        <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
          {/* Elevation is the border. The stacked plates read as depth because
              they are offset and ruled, not because anything casts a shadow. */}
          <div className="absolute inset-3 rotate-6 rounded-surface border border-rule bg-surface" />
          <div className="absolute inset-5 -rotate-3 rounded-surface border border-rule bg-ground" />
          <Search className="relative size-12 text-ink" strokeWidth={1.75} />
          <SlidersHorizontal className="absolute bottom-1 right-0 size-6 text-filter-active" />
        </div>
        <h2 className="mt-3 type-section text-ink-muted">{t('title')}</h2>
        <p className="mt-2 max-w-xl type-body-sm">{t('description')}</p>

        {/*
          A zero-result page is the one page that cannot end. Both exits are
          links, not buttons: they navigate, so they are reachable by keyboard
          in reading order, openable in a new tab, and announced as links.
        */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {hasNonSearchFilters ? (
            <Link
              href={clearFiltersHref}
              data-ph-no-autocapture
              onClick={() =>
                trackCtaClicked(
                  'clear_filters',
                  'empty_state',
                  clearFiltersHref,
                  routes.brands(),
                )
              }
              className="inline-flex min-h-12 items-center gap-1 type-nav font-semibold text-accent underline-offset-4 hover:underline"
            >
              {t('actions.clearFilters.title')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Link
            href={routes.brands()}
            data-ph-no-autocapture
            onClick={() =>
              trackCtaClicked(
                'browse_all',
                'empty_state',
                routes.brands(),
                routes.brands(),
              )
            }
            className="inline-flex min-h-12 items-center gap-1 type-nav font-semibold text-accent underline-offset-4 hover:underline"
          >
            {t('actions.browseAll.title')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {recommendedBrands.length > 0 ? (
        <section className="border-t border-rule pt-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="type-card-title">{t('recommendations')}</h2>
            <Link
              href={recommendationsHref}
              data-ph-no-autocapture
              onClick={() => trackCtaClicked('view_all', 'empty_state', recommendationsHref, routes.brands())}
              className="inline-flex min-h-12 items-center gap-1 font-medium hover:text-accent"
            >
              {t('viewAll')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <Grid>
            {recommendedBrands.map((brand, index) => (
              <BrandCard
                key={brand.id}
                brand={brand}
                position={index}
                variant="recommendation"
              />
            ))}
          </Grid>
        </section>
      ) : null}
    </div>
  )
}
