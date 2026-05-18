import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getBrands } from '@/lib/services/brands'
import { getTags } from '@/lib/services/taxonomy'
import { parsePageParam, parseSortParam, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { TaxonomyFilterSidebar } from '@/components/brands/taxonomy-filter-sidebar'
import { BrandGrid } from '@/components/brands/brand-grid'
import { Pagination } from '@/components/brands/pagination'
import { SortSelect } from '@/components/brands/sort-select'

export const metadata: Metadata = {
  title: 'Brand Directory — MIT Map',
  description: 'Discover curated Made in Taiwan brands across all categories',
}

// ISR: revalidate every hour
export const revalidate = 3600

interface BrandsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const params = await searchParams

  const page = parsePageParam(params.page as string | undefined)
  const sort = parseSortParam(params.sort as string | undefined)
  const tags =
    typeof params.tags === 'string'
      ? params.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  const [{ brands, totalCount }, allTags] = await Promise.all([
    getBrands({
      status: 'approved',
      tags: tags.length > 0 ? tags : undefined,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    }),
    getTags(),
  ])

  // Clamp page to last valid page if user navigated beyond
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE)
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page

  // If page was clamped, re-fetch with correct offset
  let displayBrands = brands
  if (clampedPage !== page && totalCount > 0) {
    const refetched = await getBrands({
      status: 'approved',
      tags: tags.length > 0 ? tags : undefined,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (clampedPage - 1) * DEFAULT_PAGE_SIZE,
    })
    displayBrands = refetched.brands
  }

  // Build searchParams record for pagination links (excluding page)
  const paginationParams: Record<string, string> = {}
  if (tags.length > 0) paginationParams.tags = tags.join(',')
  if (sort !== 'name') paginationParams.sort = sort

  // Calculate display range
  const rangeStart = totalCount > 0 ? (clampedPage - 1) * DEFAULT_PAGE_SIZE + 1 : 0
  const rangeEnd = Math.min(clampedPage * DEFAULT_PAGE_SIZE, totalCount)

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      {/* Page header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold leading-tight text-foreground">
            Brand Directory
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount > 0
              ? `Showing ${rangeStart}–${rangeEnd} of ${totalCount} brand${totalCount !== 1 ? 's' : ''}`
              : '0 brands found'}
          </p>
        </div>
        <Suspense fallback={null}>
          <SortSelect />
        </Suspense>
      </div>

      {/* Layout: sidebar + grid */}
      <div className="flex gap-8">
        <Suspense fallback={<div className="hidden w-52 shrink-0 md:block" />}>
          <TaxonomyFilterSidebar tags={allTags} />
        </Suspense>

        <div className="min-w-0 flex-1">
          <Suspense
            fallback={
              <div
                className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4"
                aria-label="Loading brands..."
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card">
                    <div className="aspect-[4/3] animate-pulse rounded-t-xl bg-muted" />
                    <div className="p-4">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            }
          >
            <BrandGrid brands={displayBrands} />
          </Suspense>

          <Pagination
            totalCount={totalCount}
            currentPage={clampedPage}
            pageSize={DEFAULT_PAGE_SIZE}
            searchParams={paginationParams}
          />
        </div>
      </div>
    </main>
  )
}
