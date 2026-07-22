import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ChevronRight } from 'lucide-react'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale, getMessages } from 'next-intl/server'
import { getBrands, getRandomBrands, getSubcategoryCounts } from '@/lib/services/brands'
import { getAppSetting, SUBCATEGORY_FILTER_KEY } from '@/lib/services/app-settings'
import { categoryLabel, PRODUCT_SUBCATEGORIES, PRODUCT_TYPE_CATEGORIES, resolveSubcategorySlugs } from '@/lib/taxonomy/ontology'
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
import {
  SearchEmptyState,
  type ActiveDirectoryFilter,
} from '@/components/brands/search-empty-state'
import { ViewItemListTracker } from '@/components/analytics/view-item-list-tracker'
import { surfaceCardStyles } from '@/components/ui/card'
import { SavedBrandsProvider } from '@/hooks/use-saved-brands'
import { Link } from '@/i18n/navigation'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { truncateForMeta } from '@/lib/text/truncate-for-meta'
import type { Brand, BrandFilters } from '@/lib/types'
import { localizePath } from '@/i18n/locale-preference'
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from '@/lib/directory-filter-url'

// ISR: revalidate every hour
export const revalidate = 3600

const VALID_CATEGORY_SLUGS: Set<string> = new Set(PRODUCT_TYPE_CATEGORIES.map((c) => c.slug))
const EMPTY_STATE_RECOMMENDATION_LIMIT = 4

interface BrandsPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function parseVerificationParam(
  value: string | string[] | undefined
): NonNullable<BrandFilters['verificationFilter']> {
  return value === 'mit-verified' || value === 'mit-declared' || value === 'owned' || value === 'all'
    ? value
    : 'all'
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
  const categoryFilter = parseCommaParam(sp.category)
  const validCategoryFilter = categoryFilter.filter((slug) => VALID_CATEGORY_SLUGS.has(slug))
  const singleValidCategory = validCategoryFilter.length === 1
    ? validCategoryFilter.at(0) ?? null
    : null
  const subcategoryFilterEnabled = await getAppSetting<boolean>(SUBCATEGORY_FILTER_KEY, true)
  const resolvedSubs = subcategoryFilterEnabled
    ? resolveSubcategorySlugs(singleValidCategory, parseCommaParam(sp.sub))
    : []

  if (singleValidCategory) {
    const categorySlug = singleValidCategory
    const categoryTag = PRODUCT_TYPE_CATEGORIES.find((c) => c.slug === categorySlug)

    if (categoryTag) {
      const catT = await getTranslations('categories')
      const displayName = categoryLabel(categoryTag, safeLocale)
      const activeSubcategory = resolvedSubs.length === 1 ? resolvedSubs.at(0) : undefined
      const subName = activeSubcategory
        ? safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn
        : undefined
      const description = truncateForMeta(activeSubcategory && subName
        ? catT('subMetadata.description', { subName, categoryName: displayName })
        : catT.has(`descriptions.${categorySlug}`)
          ? catT(`descriptions.${categorySlug}`)
          : catT('metadata.description', { displayName, name: categoryTag.name }))
      const categoryCanonical = appendCategoryQuery(canonical, categorySlug)
      const categoryLanguages = Object.fromEntries(
        Object.entries(languages).map(([language, url]) => [
          language,
          appendCategoryQuery(url, categorySlug),
        ])
      )
      const title = activeSubcategory && subName
        ? catT('subMetadata.title', { subName, categoryName: displayName })
        : catT('metadata.title', { displayName })

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

  const brandsT = await getTranslations('brands')

  return {
    title: { absolute: brandsT('metadata.title') },
    description: brandsT('metadata.description'),
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
  const [t, verificationT, messages, subcategoryFilterEnabled] = await Promise.all([
    getTranslations('brands'),
    getTranslations('brands.verificationFilter'),
    getMessages(),
    getAppSetting<boolean>(SUBCATEGORY_FILTER_KEY, true),
  ])
  const sp = await searchParams

  const page = parsePageParam(sp.page as string | undefined)
  const sort = parseSortParam(sp.sort as string | undefined)
  const search =
    typeof sp.search === 'string' ? sp.search.trim() : ''
  const categoryFilter = parseCommaParam(sp.category)
  const validCategoryFilter = categoryFilter.filter((slug) => VALID_CATEGORY_SLUGS.has(slug))
  const singleValidCategory = validCategoryFilter.length === 1
    ? validCategoryFilter.at(0) ?? null
    : null
  const categoryTag = singleValidCategory
    ? PRODUCT_TYPE_CATEGORIES.find((category) => category.slug === singleValidCategory)
    : undefined
  const resolvedSubs = subcategoryFilterEnabled
    ? resolveSubcategorySlugs(singleValidCategory, parseCommaParam(sp.sub))
    : []
  const activeSubcategory = resolvedSubs.length === 1 ? resolvedSubs.at(0) : undefined
  const pageHeading = categoryTag ? categoryLabel(categoryTag, safeLocale) : t('heading')
  const priceRanges = parsePriceRanges(sp.price)
  const verificationFilter = parseVerificationParam(sp.verification)

  const [{ brands, totalCount }, subcategoryCounts] = await Promise.all([
    getBrands({
      status: 'approved',
      search: search || undefined,
      category: validCategoryFilter.length > 0 ? validCategoryFilter : undefined,
      subcategoryTags: resolvedSubs.map((subcategory) => subcategory.nameZh),
      priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
      verificationFilter,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    }),
    subcategoryFilterEnabled && singleValidCategory
      ? getSubcategoryCounts(singleValidCategory)
      : Promise.resolve(new Map<string, number>()),
  ])
  const subcategoriesWithCounts = singleValidCategory
    ? PRODUCT_SUBCATEGORIES
        .filter((subcategory) => subcategory.category === singleValidCategory)
        .map((subcategory) => ({
          ...subcategory,
          count: subcategoryCounts.get(subcategory.nameZh) ?? 0,
        }))
        .filter((subcategory) => subcategory.count > 0)
    : []
  const subcategoryOptions = subcategoriesWithCounts.map((subcategory) => ({
    slug: subcategory.slug,
    label: safeLocale === 'zh-TW' ? subcategory.nameZh : subcategory.nameEn,
    count: subcategory.count,
  }))
  const activeSubSlugs = resolvedSubs.map((subcategory) => subcategory.slug)

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
      subcategoryTags: resolvedSubs.map((subcategory) => subcategory.nameZh),
      priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
      verificationFilter,
      sort,
      limit: DEFAULT_PAGE_SIZE,
      offset: (clampedPage - 1) * DEFAULT_PAGE_SIZE,
    })
    displayBrands = refetched.brands
  }

  const directoryPath = localizePath('/brands', safeLocale)
  const normalizedParams = new URLSearchParams()
  if (search) normalizedParams.set('search', search)
  if (validCategoryFilter.length > 0) {
    normalizedParams.set('category', validCategoryFilter.join(','))
  }
  if (activeSubSlugs.length > 0) normalizedParams.set('sub', activeSubSlugs.join(','))
  if (priceRanges.length > 0) normalizedParams.set('price', priceRanges.join(','))
  if (verificationFilter !== 'all') normalizedParams.set('verification', verificationFilter)
  if (sort !== 'random') normalizedParams.set('sort', sort)

  const activeFilters: ActiveDirectoryFilter[] = []
  if (search) {
    activeFilters.push({
      id: 'search',
      label: t('filters.activeSearch'),
      value: search,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, { search: null }),
      removeLabel: t('filters.removeFilter', {
        label: t('filters.activeSearch'),
        value: search,
      }),
    })
  }
  for (const slug of validCategoryFilter) {
    const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug)
    if (!category) continue
    const value = categoryLabel(category, safeLocale)
    const remainingCategories = validCategoryFilter.filter((item) => item !== slug)
    activeFilters.push({
      id: `category-${slug}`,
      label: t('filters.activeCategory'),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        category: remainingCategories.length > 0 ? remainingCategories.join(',') : null,
        sub: null,
      }),
      removeLabel: t('filters.removeFilter', {
        label: t('filters.activeCategory'),
        value,
      }),
    })
  }
  for (const subcategory of resolvedSubs) {
    const value = safeLocale === 'zh-TW' ? subcategory.nameZh : subcategory.nameEn
    const remainingSubs = resolvedSubs.filter((item) => item.slug !== subcategory.slug)
    activeFilters.push({
      id: `subcategory-${subcategory.slug}`,
      label: t('filters.activeSubcategory'),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        sub: remainingSubs.length > 0
          ? remainingSubs.map((item) => item.slug).join(',')
          : null,
      }),
      removeLabel: t('filters.removeFilter', {
        label: t('filters.activeSubcategory'),
        value,
      }),
    })
  }
  for (const priceRange of priceRanges) {
    const value = '$'.repeat(priceRange)
    const remainingPrices = priceRanges.filter((item) => item !== priceRange)
    activeFilters.push({
      id: `price-${priceRange}`,
      label: t('filters.activePrice'),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        price: remainingPrices.length > 0 ? remainingPrices.join(',') : null,
      }),
      removeLabel: t('filters.removeFilter', {
        label: t('filters.activePrice'),
        value,
      }),
    })
  }
  if (verificationFilter !== 'all') {
    const value = verificationT(verificationFilter)
    activeFilters.push({
      id: 'verification',
      label: t('filters.activeStatus'),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, { verification: null }),
      removeLabel: t('filters.removeFilter', {
        label: t('filters.activeStatus'),
        value,
      }),
    })
  }

  let recommendedBrands: Brand[] = []
  let recommendationsHref = directoryPath
  if (totalCount === 0) {
    if (validCategoryFilter.length > 0) {
      const recommendations = await getBrands({
        status: 'approved',
        category: validCategoryFilter,
        sort: 'random',
        limit: EMPTY_STATE_RECOMMENDATION_LIMIT,
        offset: 0,
      })
      recommendedBrands = recommendations.brands
      if (recommendedBrands.length > 0) {
        recommendationsHref = updateDirectoryUrl(directoryPath, new URLSearchParams(), {
          category: validCategoryFilter.join(','),
        })
      }
    }
    if (recommendedBrands.length === 0) {
      recommendedBrands = await getRandomBrands(EMPTY_STATE_RECOMMENDATION_LIMIT)
    }
  }

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
  if (categoryTag) {
    const categorySlug = categoryTag.slug
    const catT = await getTranslations('categories')
    const categoryName = categoryLabel(categoryTag, safeLocale)
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
    const breadcrumbItems = [
      { label: 'Brands', href: '/brands' },
      {
        label: categoryName,
        ...(activeSubcategory
          ? { href: `/brands?category=${encodeURIComponent(categorySlug)}` }
          : {}),
      },
    ]
    if (activeSubcategory) {
      breadcrumbItems.push({
        label: safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn,
      })
    }
    categoryBreadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems, safeLocale)
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
          <BrandFilterSidebar
            activeFilters={activeFilters}
            categories={[...PRODUCT_TYPE_CATEGORIES]}
            subcategories={subcategoryOptions}
            activeSubSlugs={activeSubSlugs}
            totalCount={totalCount}
          />
        </div>
      </aside>

      <div className="min-w-0">
        {activeSubcategory && categoryTag ? (
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex items-center gap-1.5 type-card-description">
              <li>
                <Link href="/brands" className="transition-colors hover:text-foreground">
                  {t('heading')}
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li>
                <Link
                  href={`/brands?category=${encodeURIComponent(categoryTag.slug)}`}
                  className="transition-colors hover:text-foreground"
                >
                  {pageHeading}
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li>
                <span aria-current="page" className="font-medium text-foreground">
                  {safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn}
                </span>
              </li>
            </ol>
          </nav>
        ) : null}
        {displayBrands.length === 0 ? (
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <h1 className="text-balance type-page-title">{pageHeading}</h1>
                <p className="type-card-description" aria-live="polite" aria-atomic="true">
                  {t('notFound')}
                </p>
              </div>
              <div className="mt-3 lg:hidden">
                <BrandFilterDrawer
                  activeFilters={activeFilters}
                  categories={[...PRODUCT_TYPE_CATEGORIES]}
                  subcategories={subcategoryOptions}
                  activeSubSlugs={activeSubSlugs}
                  totalCount={totalCount}
                />
              </div>
            </div>
            <Suspense fallback={null}>
              <SortSelect />
            </Suspense>
          </div>
        ) : (
          <>
            <h1 className="mb-6 text-balance type-page-title">{pageHeading}</h1>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <BrandFilterDrawer
                  activeFilters={activeFilters}
                  categories={[...PRODUCT_TYPE_CATEGORIES]}
                  subcategories={subcategoryOptions}
                  activeSubSlugs={activeSubSlugs}
                  totalCount={totalCount}
                />
                <p className="type-card-description" aria-live="polite" aria-atomic="true">
                  {t('count', { count: totalCount })}
                </p>
              </div>
              <Suspense fallback={null}>
                <SortSelect />
              </Suspense>
            </div>
          </>
        )}

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
                <SearchEmptyState
                  query={search}
                  categoryLabel={categoryTag ? categoryLabel(categoryTag, safeLocale) : undefined}
                  activeFilters={activeFilters}
                  clearAllHref={clearDirectoryFilters(directoryPath, normalizedParams, { includeSearch: true })}
                  recommendedBrands={recommendedBrands}
                  recommendationsHref={recommendationsHref}
                />
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
          />
      </div>
    </main>
    </NextIntlClientProvider>
  )
}
