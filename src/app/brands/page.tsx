import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getBrands } from '@/lib/services/brands'
import { buildWebSiteJsonLd } from '@/lib/json-ld'
import { parsePageParam, parseSortParam, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { MasonryGrid } from '@/components/brands/masonry-grid'
import { BrandCard } from '@/components/brands/brand-card'
import { Pagination } from '@/components/brands/pagination'
import { SortSelect } from '@/components/brands/sort-select'

export const metadata: Metadata = {
  title: { absolute: 'MIT Map — Made in Taiwan Brand Directory' },
  description:
    'Discover thoughtfully curated Taiwanese brands. Browse by category, search, and explore the best of Made in Taiwan.',
  alternates: { canonical: '/brands' },
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
  const search =
    typeof params.search === 'string' ? params.search.trim() : ''
  const categoryFilter =
    typeof params.category === 'string' ? params.category.trim() : ''
  const tags =
    typeof params.tags === 'string'
      ? params.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  const { brands, totalCount } = await getBrands({
    status: 'approved',
    search: search || undefined,
    category: categoryFilter || undefined,
    tags: tags.length > 0 ? tags : undefined,
    sort,
    limit: DEFAULT_PAGE_SIZE,
    offset: (page - 1) * DEFAULT_PAGE_SIZE,
  })

  // Clamp page to last valid page if user navigated beyond
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE)
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page

  // If page was clamped, re-fetch with correct offset
  let displayBrands = brands
  if (clampedPage !== page && totalCount > 0) {
    const refetched = await getBrands({
      status: 'approved',
      search: search || undefined,
      category: categoryFilter || undefined,
      tags: tags.length > 0 ? tags : undefined,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (clampedPage - 1) * DEFAULT_PAGE_SIZE,
    })
    displayBrands = refetched.brands
  }

  // Build searchParams record for pagination links (excluding page)
  const paginationParams: Record<string, string> = {}
  if (search) paginationParams.search = search
  if (tags.length > 0) paginationParams.tags = tags.join(',')
  if (sort !== 'name') paginationParams.sort = sort
  if (categoryFilter) paginationParams.category = categoryFilter

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildWebSiteJsonLd()) }}
      />

      {/* Count + sort header */}
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalCount > 0
            ? `${totalCount} brand${totalCount !== 1 ? 's' : ''}`
            : '0 brands found'}
        </p>
        <Suspense fallback={null}>
          <SortSelect />
        </Suspense>
      </div>

      {/* Masonry brand grid */}
      <Suspense
        fallback={
          <div
            className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-4"
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
        {displayBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-base font-semibold text-foreground">
              No brands found
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try adjusting or clearing your filters.
            </p>
          </div>
        ) : (
          <MasonryGrid>
            {displayBrands.map((brand, index) => (
              <BrandCard key={brand.id} brand={brand} priority={index < 4} />
            ))}
          </MasonryGrid>
        )}
      </Suspense>

      <Pagination
        totalCount={totalCount}
        currentPage={clampedPage}
        pageSize={DEFAULT_PAGE_SIZE}
        searchParams={paginationParams}
      />
    </main>
  )
}
