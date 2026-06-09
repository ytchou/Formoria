import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getBrands } from '@/lib/services/brands'
import { getActiveCategories, getValueTagsWithCoverage } from '@/lib/services/taxonomy'
import { buildWebSiteJsonLd } from '@/lib/json-ld'
import { parsePageParam, parseSortParam, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import {
  BrandFilterDrawer,
  BrandFilterSidebar,
} from '@/components/brands/brand-filter-sidebar'
import { MasonryGrid } from '@/components/brands/masonry-grid'
import { BrandCard } from '@/components/brands/brand-card'
import { Pagination } from '@/components/brands/pagination'
import { SortSelect } from '@/components/brands/sort-select'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import type { BrandFilters } from '@/lib/types'

// ISR: revalidate every hour
export const revalidate = 3600

interface BrandsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function parseVerificationParam(
  value: string | string[] | undefined
): NonNullable<BrandFilters['verificationFilter']> {
  return value === 'mit-verified' || value === 'owned' || value === 'all' ? value : 'all'
}

function parseCommaParam(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((item) =>
    item
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

export async function generateMetadata({ params }: BrandsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { canonical, languages } = buildAlternates('/brands', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
  return {
    title: { absolute: 'Formoria — Made in Taiwan Brand Directory' },
    description:
      'Discover thoughtfully curated Taiwanese brands. Browse by category, search, and explore the best of Made in Taiwan.',
    alternates: { canonical, languages },
    openGraph: {
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    },
  }
}

export default async function BrandsPage({ params, searchParams }: BrandsPageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('brands')
  const sp = await searchParams

  const page = parsePageParam(sp.page as string | undefined)
  const sort = parseSortParam(sp.sort as string | undefined)
  const search =
    typeof sp.search === 'string' ? sp.search.trim() : ''
  const categoryFilter = parseCommaParam(sp.category)
  const verificationFilter = parseVerificationParam(sp.verification)
  const tags = parseCommaParam(sp.tags)

  const [{ brands, totalCount }, categories, valueTags] = await Promise.all([
    getBrands({
      status: 'approved',
      search: search || undefined,
      category: categoryFilter.length > 0 ? categoryFilter : undefined,
      verificationFilter,
      tags: tags.length > 0 ? tags : undefined,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    }),
    getActiveCategories(),
    getValueTagsWithCoverage(),
  ])

  // Clamp page to last valid page if user navigated beyond
  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE)
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page

  // If page was clamped, re-fetch with correct offset
  let displayBrands = brands
  if (clampedPage !== page && totalCount > 0) {
    const refetched = await getBrands({
      status: 'approved',
      search: search || undefined,
      category: categoryFilter.length > 0 ? categoryFilter : undefined,
      verificationFilter,
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
  if (categoryFilter.length > 0) paginationParams.category = categoryFilter.join(',')
  if (verificationFilter !== 'all') paginationParams.verification = verificationFilter

  return (
    <main className="mx-auto grid w-full max-w-screen-xl gap-8 px-6 py-10 md:px-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildWebSiteJsonLd(safeLocale)) }}
      />

      <aside className="hidden lg:block" aria-label={t('filters.title')}>
        <div className="sticky top-24">
          <BrandFilterSidebar categories={categories} valueTags={valueTags} />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Count + sort header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandFilterDrawer
              categories={categories}
              valueTags={valueTags}
              totalCount={totalCount}
            />
            <p className="text-sm text-muted-foreground">
              {totalCount > 0 ? t('count', { count: totalCount }) : t('notFound')}
            </p>
          </div>
          <Suspense fallback={null}>
            <SortSelect />
          </Suspense>
        </div>

        {/* Masonry brand grid */}
        <Suspense
          fallback={
            <div
              className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-4"
              aria-label={t('loadingAria')}
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
                {t('emptyTitle')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('emptyDescription')}
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
      </div>
    </main>
  )
}
