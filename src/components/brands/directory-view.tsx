import { Suspense } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { getPublicBrandCards, getRandomBrands, getSubcategorySummary } from '@/lib/services/brands'
import { categoryLabel, PRODUCT_SUBCATEGORIES, PRODUCT_TYPE_CATEGORIES, resolveSubcategorySlugs } from '@/lib/taxonomy/ontology'
import { buildBreadcrumbJsonLd, buildCategoryItemListJsonLd, buildBrandsItemListJsonLd, buildWebSiteJsonLd, safeJsonLdStringify } from '@/lib/json-ld'
import { DEFAULT_PAGE_SIZE, type BrandSortOption } from '@/lib/pagination'
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
import type { Locale } from '@/lib/seo/alternates'
import type { DirectoryViewFilters } from '@/lib/seo/directory-filters'
import { localizePath } from '@/i18n/locale-preference'
import { updateDirectoryUrl } from '@/lib/directory-filter-url'
import type { PublicBrandCard } from '@/lib/brands/contracts'
import { DirectoryLandingHead } from './directory-landing-head'

const EMPTY_STATE_RECOMMENDATION_LIMIT = 4
const VALID_CATEGORY_SLUGS: ReadonlySet<string> = new Set(PRODUCT_TYPE_CATEGORIES.map((category) => category.slug))

export type DirectoryViewProps = {
  locale: Locale
  filters: DirectoryViewFilters
  page: number
  sort: BrandSortOption
  /** Canonical resolved by the route's SEO matrix for this exact request. */
  canonical: string
  isCategoryRoute?: boolean
}

export async function DirectoryView({ locale, filters, page, sort, canonical, isCategoryRoute = false }: DirectoryViewProps) {
  const safeLocale = locale
  const [t, verificationT, messages] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: 'brands' }),
    getTranslations({ locale: safeLocale, namespace: 'brands.verificationFilter' }),
    getMessages({ locale: safeLocale }),
  ])

  const validCategoryFilter = filters.categorySlugs.filter((slug) => VALID_CATEGORY_SLUGS.has(slug))
  const singleValidCategory = validCategoryFilter.length === 1
    ? validCategoryFilter[0] ?? null
    : null
  const categoryTag = singleValidCategory
    ? PRODUCT_TYPE_CATEGORIES.find((category) => category.slug === singleValidCategory)
    : undefined
  const resolvedSubs = resolveSubcategorySlugs(categoryTag?.slug ?? null, filters.subcategorySlugs)
  const activeSubcategory = resolvedSubs.length === 1 ? resolvedSubs[0] : undefined
  const pageHeading = categoryTag ? categoryLabel(categoryTag, safeLocale) : t('heading')
  const search = filters.search ?? ''
  const priceRanges = filters.priceRanges ?? []
  const verificationFilter = filters.verificationFilter ?? 'all'
  const shouldLoadTaxonomySummary = Boolean(singleValidCategory) && !search

  const [{ brands, totalCount }, taxonomySummary] = await Promise.all([
    getPublicBrandCards({
      search: search || undefined,
      category: validCategoryFilter.length > 0 ? validCategoryFilter : undefined,
      subcategoryTags: resolvedSubs.map((subcategory) => subcategory.slug),
      priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
      verificationFilter,
      sort,
      page,
    }),
    shouldLoadTaxonomySummary && singleValidCategory
      ? getSubcategorySummary(singleValidCategory, activeSubcategory?.slug)
      : Promise.resolve({ counts: new Map<string, number>(), latestUpdatedAt: null }),
  ])
  const subcategoriesWithCounts = singleValidCategory
    ? PRODUCT_SUBCATEGORIES
        .filter((subcategory) => subcategory.category === singleValidCategory)
        .map((subcategory) => ({
          ...subcategory,
          count: taxonomySummary.counts.get(subcategory.nameZh) ?? 0,
        }))
        .filter((subcategory) => subcategory.count > 0)
    : []
  const subcategoryOptions = subcategoriesWithCounts.map((subcategory) => ({
    slug: subcategory.slug,
    label: safeLocale === 'zh-TW' ? subcategory.nameZh : subcategory.nameEn,
    count: subcategory.count,
  }))
  const activeSubSlugs = resolvedSubs.map((subcategory) => subcategory.slug)

  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE)
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page
  let displayBrands = brands
  if (clampedPage !== page && totalCount > 0 && !isCategoryRoute) {
    const refetched = await getPublicBrandCards({
      search: search || undefined,
      category: validCategoryFilter.length > 0 ? validCategoryFilter : undefined,
      subcategoryTags: resolvedSubs.map((subcategory) => subcategory.slug),
      priceRanges: priceRanges.length > 0 ? priceRanges : undefined,
      verificationFilter,
      sort,
      page: clampedPage,
    })
    displayBrands = refetched.brands
  }

  const latestUpdatedAt = taxonomySummary.latestUpdatedAt

  const routePath = categoryTag
    ? `/categories/${categoryTag.slug}${activeSubcategory ? `/${activeSubcategory.slug}` : ''}`
    : '/brands'
  const directoryPath = localizePath(routePath, safeLocale)
  const normalizedParams = new URLSearchParams()
  if (search) normalizedParams.set('search', search)
  if (validCategoryFilter.length > 0 && routePath === '/brands') {
    normalizedParams.set('category', validCategoryFilter.join(','))
  }
  if (activeSubSlugs.length > 0 && routePath === '/brands') normalizedParams.set('sub', activeSubSlugs.join(','))
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
      removeLabel: t('filters.removeFilter', { label: t('filters.activeSearch'), value: search }),
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
      removeLabel: t('filters.removeFilter', { label: t('filters.activeCategory'), value }),
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
        sub: remainingSubs.length > 0 ? remainingSubs.map((item) => item.slug).join(',') : null,
      }),
      removeLabel: t('filters.removeFilter', { label: t('filters.activeSubcategory'), value }),
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
      removeLabel: t('filters.removeFilter', { label: t('filters.activePrice'), value }),
    })
  }
  if (verificationFilter !== 'all') {
    const value = verificationT(verificationFilter)
    activeFilters.push({
      id: 'verification',
      label: t('filters.activeStatus'),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, { verification: null }),
      removeLabel: t('filters.removeFilter', { label: t('filters.activeStatus'), value }),
    })
  }

  let recommendedBrands: PublicBrandCard[] = []
  let recommendationsHref = directoryPath
  if (totalCount === 0 && !isCategoryRoute) {
    if (validCategoryFilter.length > 0) {
      const recommendations = await getPublicBrandCards({
        category: validCategoryFilter,
        sort: 'random',
        page: 1,
      })
      recommendedBrands = recommendations.brands
        .slice(0, EMPTY_STATE_RECOMMENDATION_LIMIT)
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
  if (
    validCategoryFilter.length === 0 &&
    !search &&
    priceRanges.length === 0 &&
    verificationFilter === 'all' &&
    page === 1
  ) {
    brandsItemListJsonLd = buildBrandsItemListJsonLd(displayBrands, safeLocale)
  }
  if (categoryTag) {
    const catT = await getTranslations({ locale: safeLocale, namespace: 'categories' })
    const categoryName = categoryLabel(categoryTag, safeLocale)
    const editorialDescription = catT.has(`descriptions.${categoryTag.slug}`)
      ? catT(`descriptions.${categoryTag.slug}`)
      : undefined
    categoryItemListJsonLd = buildCategoryItemListJsonLd(
      categoryName,
      canonical,
      displayBrands,
      safeLocale,
      editorialDescription,
      activeSubcategory ? categoryName : undefined,
    )
    categoryBreadcrumbJsonLd = buildBreadcrumbJsonLd([
      { label: t('heading'), href: localizePath('/brands', safeLocale) },
      {
        label: categoryName,
        ...(activeSubcategory
          ? { href: localizePath(`/categories/${categoryTag.slug}`, safeLocale) }
          : {}),
      },
      ...(activeSubcategory
        ? [{ label: safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn }]
        : []),
    ], safeLocale)
  }

  const categoryBreadcrumb = categoryTag
    ? {
        slug: categoryTag.slug,
        label: categoryLabel(categoryTag, safeLocale),
      }
    : null
  const subcategoryBreadcrumb = activeSubcategory
    ? {
        slug: activeSubcategory.slug,
        label: safeLocale === 'zh-TW' ? activeSubcategory.nameZh : activeSubcategory.nameEn,
      }
    : null

  return (
    <NextIntlClientProvider messages={messages}>
      <main className="page-gutter mx-auto grid w-full max-w-screen-xl gap-8 py-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(buildWebSiteJsonLd(safeLocale)) }}
        />
        {brandsItemListJsonLd ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(brandsItemListJsonLd) }} />
        ) : null}
        {categoryItemListJsonLd ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(categoryItemListJsonLd) }} />
        ) : null}
        {categoryBreadcrumbJsonLd ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(categoryBreadcrumbJsonLd) }} />
        ) : null}
        <ViewItemListTracker listName="directory" itemCount={displayBrands.length} />

        <aside className="hidden lg:block" aria-label={t('filters.title')}>
          <div className="sticky top-(--nav-height)">
            <BrandFilterSidebar
              activeFilters={activeFilters}
              categories={[...PRODUCT_TYPE_CATEGORIES]}
              activeCategorySlugs={validCategoryFilter}
              subcategories={subcategoryOptions}
              activeSubSlugs={activeSubSlugs}
              announceSearchLoading={!isCategoryRoute}
              totalCount={totalCount}
            />
          </div>
        </aside>

        <div className="min-w-0">
          <DirectoryLandingHead
            locale={safeLocale}
            directoryLabel={t('heading')}
            category={categoryBreadcrumb}
            subcategory={subcategoryBreadcrumb}
            breadcrumbAria={t('breadcrumbAria')}
            pageHeading={pageHeading}
            totalCount={totalCount}
            latestUpdatedAt={latestUpdatedAt}
            announceLiveRegion={isCategoryRoute}
          />
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandFilterDrawer
                activeFilters={activeFilters}
                categories={[...PRODUCT_TYPE_CATEGORIES]}
                activeCategorySlugs={validCategoryFilter}
                subcategories={subcategoryOptions}
                activeSubSlugs={activeSubSlugs}
                announceSearchLoading={!isCategoryRoute}
                totalCount={totalCount}
              />
            </div>
            <Suspense fallback={null}>
              <SortSelect />
            </Suspense>
          </div>

          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('loadingAria')}>
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className={surfaceCardStyles({ padding: 'none' })}>
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
                  recommendedBrands={recommendedBrands}
                  recommendationsHref={recommendationsHref}
                />
              ) : (
                <MasonryGrid>
                  {displayBrands.map((brand, index) => (
                    <BrandCard key={brand.id} brand={brand} preload={index < 1} />
                  ))}
                </MasonryGrid>
              )}
            </SavedBrandsProvider>
          </Suspense>

          <Pagination totalCount={totalCount} currentPage={clampedPage} pageSize={DEFAULT_PAGE_SIZE} />
        </div>
      </main>
    </NextIntlClientProvider>
  )
}
