import { Suspense } from 'react'
import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale, getMessages } from 'next-intl/server'
import { getBrands, getPopularCategories, getFeaturedBrands } from '@/lib/services/brands'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import { buildBreadcrumbJsonLd, buildCategoryItemListJsonLd, buildBrandsItemListJsonLd, buildWebSiteJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { parsePageParam, parseSortParam, DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import {
  BrandFilterDrawer,
  BrandFilterSidebar,
} from '@/components/brands/brand-filter-sidebar'
import { MasonryGrid } from '@/components/brands/masonry-grid'
import { BrandCard } from '@/components/brands/brand-card'
import { Pagination } from '@/components/brands/pagination'
import { SortSelect } from '@/components/brands/sort-select'
import { SearchEmptyStateWrapper } from '@/components/brands/search-empty-state-wrapper'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { surfaceCardStyles } from '@/components/ui/card'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import type { BrandFilters } from '@/lib/types'

// ISR: revalidate every hour
export const revalidate = 3600

const VALID_CATEGORY_SLUGS: Set<string> = new Set(PRODUCT_TYPE_CATEGORIES.map((c) => c.slug))

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

function parsePriceRanges(value: string | string[] | undefined): (1 | 2 | 3)[] {
  return parseCommaParam(value)
    .map(Number)
    .filter((price): price is 1 | 2 | 3 => price === 1 || price === 2 || price === 3)
}

function appendCategoryQuery(url: string, categorySlug: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}category=${encodeURIComponent(categorySlug)}`
}

export async function generateMetadata({ params, searchParams }: BrandsPageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const { canonical, languages } = buildAlternates('/brands', safeLocale)
  const ogLocale = safeLocale === 'zh-TW' ? 'zh_TW' : 'en_US'
  const ogAlternateLocale = safeLocale === 'zh-TW' ? 'en_US' : 'zh_TW'
  const sp = await searchParams

  if (typeof sp.category === 'string' && sp.category.trim() && !sp.category.includes(',')) {
    const categorySlug = sp.category.trim()
    const categoryTag = PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === categorySlug)

    if (categoryTag) {
      const catT = await getTranslations('categories')
      const displayName = safeLocale === 'zh-TW' ? categoryTag.nameZh : categoryTag.name
      const description = catT.has(`descriptions.${categorySlug}`)
        ? catT(`descriptions.${categorySlug}`)
        : catT('metadata.description', { displayName, name: categoryTag.name })
      const categoryCanonical = appendCategoryQuery(canonical, categorySlug)
      const categoryLanguages = Object.fromEntries(
        Object.entries(languages).map(([language, url]) => [
          language,
          appendCategoryQuery(url, categorySlug),
        ])
      )
      const title = catT('metadata.title', { displayName })

      return {
        title,
        description,
        alternates: { canonical: categoryCanonical, languages: categoryLanguages },
        openGraph: {
          title,
          description,
          url: categoryCanonical,
          locale: ogLocale,
          alternateLocale: [ogAlternateLocale],
        },
        twitter: {
          title,
          description,
        },
      }
    }
  }

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
  const [t, messages] = await Promise.all([
    getTranslations('brands'),
    getMessages(),
  ])
  const sp = await searchParams

  const page = parsePageParam(sp.page as string | undefined)
  const sort = parseSortParam(sp.sort as string | undefined)
  const search =
    typeof sp.search === 'string' ? sp.search.trim() : ''
  const categoryFilter = parseCommaParam(sp.category)
  const validCategoryFilter = categoryFilter.filter((slug) => VALID_CATEGORY_SLUGS.has(slug))
  const priceRanges = parsePriceRanges(sp.price)
  const verificationFilter = parseVerificationParam(sp.verification)

  const { brands, totalCount } = await getBrands({
    status: 'approved',
    search: search || undefined,
    category: validCategoryFilter.length > 0 ? validCategoryFilter : undefined,
    priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
    verificationFilter,
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
      category: validCategoryFilter.length > 0 ? validCategoryFilter : undefined,
      priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
      verificationFilter,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (clampedPage - 1) * DEFAULT_PAGE_SIZE,
    })
    displayBrands = refetched.brands
  }

  // Fetch empty-state fallback data when search yields zero results
  const hasActiveFilters =
    validCategoryFilter.length > 0 || priceRanges.length > 0 || verificationFilter !== 'all'
  let emptyStateData: {
    categories: { productType: string; name: string; nameZh: string | null; count: number }[]
    featured: { id: string; name: string; slug: string; heroImageUrl: string | null; category: string }[]
  } | null = null
  if (totalCount === 0 && search) {
    const [rawCategories, featured] = await Promise.all([
      getPopularCategories(5),
      getFeaturedBrands(6),
    ])
    const categories = rawCategories.map(({ productType, count }) => {
      const match = PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === productType)
      return {
        productType,
        name: match?.name ?? productType,
        nameZh: match?.nameZh ?? null,
        count,
      }
    })
    emptyStateData = { categories, featured }
  }

  // Build searchParams record for pagination links (excluding page)
  const paginationParams: Record<string, string> = {}
  if (search) paginationParams.search = search
  if (sort !== 'name') paginationParams.sort = sort
  if (validCategoryFilter.length > 0) paginationParams.category = validCategoryFilter.join(',')
  if (priceRanges.length > 0) paginationParams.price = priceRanges.join(',')
  if (verificationFilter !== 'all') paginationParams.verification = verificationFilter

  let categoryItemListJsonLd = null
  let categoryBreadcrumbJsonLd = null
  let brandsItemListJsonLd = null
  const hasNoCategoryFilter = validCategoryFilter.length === 0
  const hasNoSearchQuery = !search
  const hasNoPriceRangeFilter = priceRanges.length === 0
  const hasNoVerificationFilter = verificationFilter === 'all'
  if (
    hasNoCategoryFilter &&
    hasNoSearchQuery &&
    hasNoPriceRangeFilter &&
    hasNoVerificationFilter &&
    page === 1
  ) {
    brandsItemListJsonLd = buildBrandsItemListJsonLd(displayBrands, safeLocale)
  }
  if (validCategoryFilter.length === 1) {
    const categorySlug = validCategoryFilter[0]
    const catT = await getTranslations('categories')
    const categoryTag = PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === categorySlug)

    if (categoryTag) {
      const categoryName = safeLocale === 'zh-TW' ? categoryTag.nameZh : categoryTag.name
      const editorialDescription = catT.has(`descriptions.${categorySlug}`)
        ? catT(`descriptions.${categorySlug}`)
        : undefined
      categoryItemListJsonLd = buildCategoryItemListJsonLd(
        categoryName,
        categorySlug,
        displayBrands,
        safeLocale,
        editorialDescription
      )
      categoryBreadcrumbJsonLd = buildBreadcrumbJsonLd(
        [{ label: 'Brands', href: '/brands' }, { label: categoryName }],
        safeLocale
      )
    }
  }

  return (
    <NextIntlClientProvider messages={messages}>
    <main className="page-gutter mx-auto grid w-full max-w-screen-xl gap-8 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildWebSiteJsonLd(safeLocale)) }}
      />
      {brandsItemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(brandsItemListJsonLd) }}
        />
      ) : null}
      {categoryItemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(categoryItemListJsonLd) }}
        />
      ) : null}
      {categoryBreadcrumbJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(categoryBreadcrumbJsonLd) }}
        />
      ) : null}
      <ViewItemListTracker listName="directory" itemCount={displayBrands.length} />

      <aside className="hidden lg:block" aria-label={t('filters.title')}>
        <div className="sticky top-24">
          <BrandFilterSidebar categories={[...PRODUCT_TYPE_CATEGORIES]} />
        </div>
      </aside>

      <div className="min-w-0">
        {/* Count + sort header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandFilterDrawer
              categories={[...PRODUCT_TYPE_CATEGORIES]}
              totalCount={totalCount}
            />
            <p className="type-card-description">
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
                <div key={i} className={surfaceCardStyles({ padding: 'none' })}>
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
          <SavedBrandsProvider>
            {displayBrands.length === 0 ? (
              emptyStateData ? (
                <SearchEmptyStateWrapper
                  query={search}
                  hasActiveFilters={hasActiveFilters}
                  categories={emptyStateData.categories}
                  featuredBrands={emptyStateData.featured}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <p className="type-empty-title">
                    {t('emptyTitle')}
                  </p>
                  <p className="mt-1 type-card-description">
                    {t('emptyDescription')}
                  </p>
                </div>
              )
            ) : (
              <MasonryGrid>
                {displayBrands.map((brand, index) => (
                  <BrandCard key={brand.id} brand={brand} priority={index < 4} />
                ))}
              </MasonryGrid>
            )}
          </SavedBrandsProvider>
        </Suspense>

        <Pagination
          totalCount={totalCount}
          currentPage={clampedPage}
          pageSize={DEFAULT_PAGE_SIZE}
          basePath="/brands"
          searchParams={paginationParams}
        />
      </div>
    </main>
    </NextIntlClientProvider>
  )
}
