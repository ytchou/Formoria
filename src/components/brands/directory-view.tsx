import { SearchInput } from "@/components/brands/search-input";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import {
  directoryBrandCategoryFilter,
  getPublicBrandCards,
  getRandomBrands,
  getSubcategoryCountsAcross,
  getSubcategorySummary,
  type SubcategorySummary,
} from "@/lib/services/brands";
import {
  categoryLabel,
  L2_SUBCATEGORIES,
  L1_CATEGORIES,
  VISIBLE_L1_CATEGORIES,
  resolveDirectorySubcategorySlugs,
} from "@/lib/taxonomy/ontology";
import {
  buildBreadcrumbJsonLd,
  buildCategoryItemListJsonLd,
  buildBrandsItemListJsonLd,
  buildWebSiteJsonLd,
  safeJsonLdStringify,
} from "@/lib/json-ld";
import { DEFAULT_PAGE_SIZE, type BrandSortOption } from "@/lib/pagination";
import {
  BrandFilterDrawer,
  BrandFilterSidebar,
} from "@/components/brands/brand-filter-sidebar";
import { MasonryGrid } from "@/components/brands/masonry-grid";
import { BrandCard } from "@/components/brands/brand-card";
import { Pagination } from "@/components/brands/pagination";
import { SortSelect } from "@/components/brands/sort-select";
import {
  SearchEmptyState,
  type ActiveDirectoryFilter,
} from "@/components/brands/search-empty-state";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import { SearchResultsTracker } from "@/components/analytics/search-results-tracker";
import { surfaceCardStyles } from "@/components/ui/card";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import type { Locale } from "@/lib/seo/alternates";
import type { DirectoryViewFilters } from "@/lib/seo/directory-filters";
import { localizePath } from "@/i18n/locale-preference";
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from "@/lib/directory-filter-url";
import {
  buildDirectoryUrlState,
  directoryCategoryChipSlugs,
  directoryTaxonomyHref,
  shouldEmitDirectoryItemList,
} from "@/lib/brands/directory-presentation";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import { DirectoryResultStatus } from "./directory-landing-head";
import { routes } from "@/lib/routes";
import { PageShell } from "@/components/ui/page-shell";
import { ActiveFilterChips, FilterAside } from "@/components/filters";
import { DirectoryHeader } from "@/components/directory/directory-header";
import { DirectoryToolbar } from "@/components/directory/directory-toolbar";
import { getCategoryEditorialLinks } from "@/lib/services/editorial-links";
import { getPublishedProductPreviewsForBrands } from "@/lib/services/curated-products";
import { captureReadFailure } from "@/lib/degraded-render";
import {
  RelatedStoryLink,
  RelatedTrailLink,
} from "@/components/stories/related-story-link";

const EMPTY_STATE_RECOMMENDATION_LIMIT = 4;
const EMPTY_TAXONOMY_SUMMARY: SubcategorySummary = {
  counts: new Map(),
  latestUpdatedAt: null,
};
const VALID_CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  VISIBLE_L1_CATEGORIES.map((category) => category.slug),
);

export type DirectoryViewProps = {
  locale: Locale;
  filters: DirectoryViewFilters;
  page: number;
  sort: BrandSortOption;
  /** Canonical resolved by the route's SEO matrix for this exact request. */
  canonical: string;
  /**
   * Whether that same matrix left this request indexable — `robots.index`, not
   * a second reading of the query string. It gates the directory `ItemList`
   * below, which must never describe a page marked `noindex`.
   */
  indexable: boolean;
  isCategoryRoute?: boolean;
};

export async function DirectoryView({
  locale,
  filters,
  page,
  sort,
  canonical,
  indexable,
  isCategoryRoute = false,
}: DirectoryViewProps) {
  const safeLocale = locale;
  const t = await getTranslations({ locale: safeLocale, namespace: "brands" });
  const commonT = await getTranslations({ locale: safeLocale, namespace: "common" });

  const validCategoryFilter = filters.categorySlugs.filter((slug) =>
    VALID_CATEGORY_SLUGS.has(slug),
  );
  const singleValidCategory =
    validCategoryFilter.length === 1 ? (validCategoryFilter[0] ?? null) : null;
  const categoryTag = singleValidCategory
    ? L1_CATEGORIES.find((category) => category.slug === singleValidCategory)
    : undefined;
  // Resolved WITHOUT conjoining the selected L1: the L2 slug already encodes its
  // parent, and testing it against the brand's own category is what discarded
  // 429 approved tag-uses and turned `?sub=` into a silent no-op (DEV-1510).
  const resolvedSubs = resolveDirectorySubcategorySlugs(
    filters.subcategorySlugs,
  );
  const activeSubSlugs = resolvedSubs.map((subcategory) => subcategory.slug);
  const activeSubcategory =
    resolvedSubs.length === 1 ? resolvedSubs[0] : undefined;
  // Presentation keeps the selected L1 (heading, breadcrumb, rail, canonical);
  // only the brand query drops it, and only while an L2 filter is active.
  const brandCategoryFilter = directoryBrandCategoryFilter(
    validCategoryFilter,
    activeSubSlugs,
  );
  const pageHeading = categoryTag
    ? categoryLabel(categoryTag, safeLocale)
    : t("heading");
  const search = filters.search ?? "";
  // The 子分類 list shows during a search too, in every scope, with
  // catalog-wide counts (never narrowed by the search), so search and panel
  // filters combine as on /discover. Under 全部 it spans every visible L1.
  // A multi-category selection gets none.
  const subcategoryScope = singleValidCategory
    ? [singleValidCategory]
    : validCategoryFilter.length === 0
      ? VISIBLE_L1_CATEGORIES.map((category) => category.slug)
      : [];
  // Only a single-L1 page without a search is dated: `latestUpdatedAt` comes
  // from getSubcategorySummary alone; every other scope has no freshness date.
  let taxonomySummaryPromise: Promise<SubcategorySummary>;
  if (singleValidCategory && !search) {
    taxonomySummaryPromise = getSubcategorySummary(
      singleValidCategory,
      activeSubcategory?.slug,
    );
  } else if (subcategoryScope.length > 0) {
    taxonomySummaryPromise = getSubcategoryCountsAcross(subcategoryScope).then(
      (counts) => ({ counts, latestUpdatedAt: null }),
    );
  } else {
    taxonomySummaryPromise = Promise.resolve(EMPTY_TAXONOMY_SUMMARY);
  }

  const [{ brands, totalCount }, taxonomySummary, editorialLinks] =
    await Promise.all([
      getPublicBrandCards({
        search: search || undefined,
        category: brandCategoryFilter,
        subcategoryTags: activeSubSlugs,
        sort,
        page,
      }),
      taxonomySummaryPromise,
      isCategoryRoute && singleValidCategory
        ? getCategoryEditorialLinks(
            singleValidCategory,
            activeSubcategory?.slug,
          )
        : Promise.resolve({ trails: [], stories: [] }),
    ]);
  const subcategoriesWithCounts = L2_SUBCATEGORIES.filter((subcategory) =>
    subcategoryScope.includes(subcategory.category),
  )
    .map((subcategory) => ({
      ...subcategory,
      count: taxonomySummary.counts.get(subcategory.slug) ?? 0,
    }))
    .filter((subcategory) => subcategory.count > 0);
  // One L1 keeps ontology order; the cross-L1 list is count-desc so the top
  // ten before 「再顯示」 are the ones that matter (same as /discover).
  if (!singleValidCategory) {
    subcategoriesWithCounts.sort((a, b) => b.count - a.count);
  }
  const subcategoryOptions = subcategoriesWithCounts.map((subcategory) => ({
    slug: subcategory.slug,
    label: safeLocale === "zh-TW" ? subcategory.nameZh : subcategory.nameEn,
    count: subcategory.count,
    // Lets the sidebar set the parent L1 when a 子分類 is picked under 全部.
    category: subcategory.category,
  }));

  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page;
  let displayBrands = brands;
  if (clampedPage !== page && totalCount > 0 && !isCategoryRoute) {
    const refetched = await getPublicBrandCards({
      search: search || undefined,
      category: brandCategoryFilter,
      subcategoryTags: activeSubSlugs,
      sort,
      page: clampedPage,
    });
    displayBrands = refetched.brands;
  }
  // One read for the whole page, keyed by the brands actually shown (after the
  // clamped re-read). A failure degrades to cards without a product strip.
  const productPreviews =
    (await getPublishedProductPreviewsForBrands(
      displayBrands.map((brand) => brand.id),
    ).catch(captureReadFailure("directory.productPreviews"))) ?? new Map();

  const latestUpdatedAt = taxonomySummary.latestUpdatedAt;

  // Surface, query string and taxonomy hrefs are all decisions over the parsed
  // filters, so they are resolved by `lib/brands/directory-presentation.ts` and
  // asserted there. The facet chips keep patching the query they live in.
  const urlState = buildDirectoryUrlState({
    locale: safeLocale,
    category: categoryTag,
    subcategory: activeSubcategory,
    categorySlugs: validCategoryFilter,
    subcategorySlugs: activeSubSlugs,
    search,
    sort,
  });
  const { directoryPath, normalizedParams } = urlState;
  const taxonomyHref = (categorySlugs: string[], subSlugs: string[]) =>
    directoryTaxonomyHref(urlState, categorySlugs, subSlugs);

  const activeFilters: ActiveDirectoryFilter[] = [];
  if (search) {
    activeFilters.push({
      id: "search",
      label: t("filters.activeSearch"),
      value: search,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        search: null,
      }),
      removeLabel: t("filters.removeFilter", {
        label: t("filters.activeSearch"),
        value: search,
      }),
    });
  }
  // Chips come from what the brand query actually conjoins, never from the raw
  // selection — see `directoryCategoryChipSlugs`.
  const categoryChipSlugs = directoryCategoryChipSlugs(
    validCategoryFilter,
    activeSubSlugs,
  );
  for (const slug of categoryChipSlugs) {
    const category = L1_CATEGORIES.find((item) => item.slug === slug);
    if (!category) continue;
    const value = categoryLabel(category, safeLocale);
    const remainingCategories = categoryChipSlugs.filter(
      (item) => item !== slug,
    );
    activeFilters.push({
      id: `category-${slug}`,
      label: t("filters.activeCategory"),
      value,
      removeHref: taxonomyHref(remainingCategories, []),
      removeLabel: t("filters.removeFilter", {
        label: t("filters.activeCategory"),
        value,
      }),
    });
  }
  for (const subcategory of resolvedSubs) {
    const value =
      safeLocale === "zh-TW" ? subcategory.nameZh : subcategory.nameEn;
    const remainingSubs = resolvedSubs.filter(
      (item) => item.slug !== subcategory.slug,
    );
    activeFilters.push({
      id: `subcategory-${subcategory.slug}`,
      label: t("filters.activeSubcategory"),
      value,
      removeHref: taxonomyHref(
        validCategoryFilter,
        remainingSubs.map((item) => item.slug),
      ),
      removeLabel: t("filters.removeFilter", {
        label: t("filters.activeSubcategory"),
        value,
      }),
    });
  }
  // Clear-all removes every chip this page shows (search, category, sub) and
  // keeps sort — the chips' own remove links, applied together.
  const clearAllHref = clearDirectoryFilters(directoryPath, normalizedParams, {
    includeSearch: true,
  });
  let recommendedBrands: PublicBrandCard[] = [];
  let recommendationsHref = directoryPath;
  if (totalCount === 0 && !isCategoryRoute) {
    if (validCategoryFilter.length > 0) {
      const recommendations = await getPublicBrandCards({
        category: validCategoryFilter,
        sort: "random",
        page: 1,
      });
      recommendedBrands = recommendations.brands.slice(
        0,
        EMPTY_STATE_RECOMMENDATION_LIMIT,
      );
      if (recommendedBrands.length > 0) {
        recommendationsHref = updateDirectoryUrl(
          directoryPath,
          new URLSearchParams(),
          {
            category: validCategoryFilter.join(","),
          },
        );
      }
    }
    if (recommendedBrands.length === 0) {
      recommendedBrands = await getRandomBrands(
        EMPTY_STATE_RECOMMENDATION_LIMIT,
      );
    }
  }

  let categoryItemListJsonLd = null;
  let categoryBreadcrumbJsonLd = null;
  let brandsItemListJsonLd = null;
  if (
    shouldEmitDirectoryItemList({
      indexable,
      categorySlugs: validCategoryFilter,
      search,
      page,
    })
  ) {
    brandsItemListJsonLd = buildBrandsItemListJsonLd(displayBrands, safeLocale);
  }
  if (categoryTag) {
    const catT = await getTranslations({
      locale: safeLocale,
      namespace: "categories",
    });
    const categoryName = categoryLabel(categoryTag, safeLocale);
    const editorialDescription = catT.has(`descriptions.${categoryTag.slug}`)
      ? catT(`descriptions.${categoryTag.slug}`)
      : undefined;
    categoryItemListJsonLd = buildCategoryItemListJsonLd(
      categoryName,
      canonical,
      displayBrands,
      safeLocale,
      editorialDescription,
      activeSubcategory ? categoryName : undefined,
    );
    categoryBreadcrumbJsonLd = buildBreadcrumbJsonLd(
      [
        {
          label: t("heading"),
          href: localizePath(routes.brands(), safeLocale),
        },
        {
          label: categoryName,
          ...(activeSubcategory
            ? {
                href: localizePath(
                  routes.brands({ category: categoryTag.slug }),
                  safeLocale,
                ),
              }
            : {}),
        },
        ...(activeSubcategory
          ? [
              {
                label:
                  safeLocale === "zh-TW"
                    ? activeSubcategory.nameZh
                    : activeSubcategory.nameEn,
              },
            ]
          : []),
      ],
      safeLocale,
    );
  }

  const sidebarProps = {
    locale: safeLocale,
    activeCategory: singleValidCategory,
    allLabel: commonT("all"),
    subcategoryOptions,
    activeSubSlugs,
    totalCount,
  };

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdStringify(buildWebSiteJsonLd(safeLocale)),
        }}
      />
      {brandsItemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(brandsItemListJsonLd),
          }}
        />
      ) : null}
      {categoryItemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(categoryItemListJsonLd),
          }}
        />
      ) : null}
      {categoryBreadcrumbJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdStringify(categoryBreadcrumbJsonLd),
          }}
        />
      ) : null}
      <ViewItemListTracker
        listName="directory"
        itemCount={displayBrands.length}
      />
      <SearchResultsTracker query={search} resultCount={totalCount} />

      <div className="space-y-stack">
        <DirectoryHeader
          title={pageHeading}
          intro={t("subheading")}
          search={
            <SearchInput
              label={t("search.aria")}
              submitLabel={t("search.submit")}
            />
          }
        />

        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Desktop sidebar */}
          <FilterAside aria-label={t("filters.title")}>
            <BrandFilterSidebar {...sidebarProps} />
          </FilterAside>

          <div className="min-w-0 flex-1">
            <DirectoryToolbar
              filterTrigger={<BrandFilterDrawer {...sidebarProps} />}
              count={
                <DirectoryResultStatus
                  locale={safeLocale}
                  totalCount={totalCount}
                  latestUpdatedAt={latestUpdatedAt}
                  announceLiveRegion={isCategoryRoute}
                />
              }
              chips={
                activeFilters.length > 0 ? (
                  <ActiveFilterChips
                    chips={activeFilters.map((filter) => ({
                      id: filter.id,
                      href: filter.removeHref,
                      label: filter.label,
                      removeLabel: filter.removeLabel,
                      value: filter.value,
                    }))}
                    clearAllHref={clearAllHref}
                    clearAllLabel={t("filters.clearAll")}
                  />
                ) : undefined
              }
              sort={
                <Suspense fallback={null}>
                  <SortSelect />
                </Suspense>
              }
            />

            <Suspense
              fallback={
                <MasonryGrid>
                  {Array.from({ length: 9 }).map((_, index) => (
                    <div
                      key={index}
                      className={surfaceCardStyles({ padding: "none" })}
                    >
                      <div className="flex flex-col gap-3 p-5">
                        <div className="h-20 w-20 animate-pulse rounded-full bg-surface" />
                        <div className="h-4 animate-pulse rounded-surface bg-surface" />
                        <div className="h-3 w-2/3 animate-pulse rounded-surface bg-surface" />
                      </div>
                    </div>
                  ))}
                </MasonryGrid>
              }
            >
              <SavedBrandsProvider>
                {displayBrands.length === 0 ? (
                  <SearchEmptyState
                    activeFilters={activeFilters}
                    recommendedBrands={recommendedBrands}
                    recommendationsHref={recommendationsHref}
                  />
                ) : (
                  <MasonryGrid>
                    {displayBrands.map((brand, index) => (
                      <BrandCard
                        key={brand.id}
                        brand={brand}
                        preload={index < 1}
                        preview={productPreviews.get(brand.id)}
                      />
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
            {editorialLinks.stories.length > 0 ||
            editorialLinks.trails.length > 0 ? (
              <nav
                aria-label={t("editorialLinksAria")}
                className="mt-section space-y-6"
              >
                {editorialLinks.stories.length > 0 ? (
                  <section aria-labelledby="category-stories" className="space-y-3">
                    <h2
                      id="category-stories"
                      className="type-card-title"
                    >
                      {t("editorialStories")}
                    </h2>
                    <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
                      {editorialLinks.stories.map((story, position) => (
                        <li key={story.slug}>
                          <RelatedStoryLink
                            href={routes.story(story.slug)}
                            storySlug={story.slug}
                            position={position}
                            storySurface="category_editorial_stories"
                            className="text-accent underline underline-offset-4 hover:text-ink"
                          >
                            {story.title}
                          </RelatedStoryLink>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {editorialLinks.trails.length > 0 ? (
                  <section aria-labelledby="category-trails" className="space-y-3">
                    <h2
                      id="category-trails"
                      className="type-card-title"
                    >
                      {t("editorialTrails")}
                    </h2>
                    <ul className="flex flex-wrap gap-x-4 gap-y-2 type-body-sm">
                      {editorialLinks.trails.map((trail, position) => (
                        <li key={trail.slug}>
                          <RelatedTrailLink
                            href={routes.trail(trail.slug)}
                            trailSlug={trail.slug}
                            position={position}
                            trailSurface="category_editorial_trails"
                            className="text-accent underline underline-offset-4 hover:text-ink"
                          >
                            {trail.title}
                          </RelatedTrailLink>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </nav>
            ) : null}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
