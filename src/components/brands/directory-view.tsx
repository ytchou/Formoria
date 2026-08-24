import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import {
  directoryBrandCategoryFilter,
  getMaterialCounts,
  getPublicBrandCards,
  getRandomBrands,
  getSubcategorySummary,
} from "@/lib/services/brands";
import {
  categoryLabel,
  L2_SUBCATEGORIES,
  L1_CATEGORIES,
  MATERIALS,
  materialBySlug,
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
import { updateDirectoryUrl } from "@/lib/directory-filter-url";
import {
  buildDirectoryUrlState,
  directoryCategoryChipSlugs,
  directoryTaxonomyHref,
  shouldEmitDirectoryItemList,
} from "@/lib/brands/directory-presentation";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import {
  DirectoryLandingHead,
  DirectoryResultStatus,
} from "./directory-landing-head";
import { routes } from "@/lib/routes";
import { Grid } from "@/components/ui/grid";
import { shellStyles } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";

const EMPTY_STATE_RECOMMENDATION_LIMIT = 4;
const VALID_CATEGORY_SLUGS: ReadonlySet<string> = new Set(
  L1_CATEGORIES.map((category) => category.slug),
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
  const [t, verificationT, messages] = await Promise.all([
    getTranslations({ locale: safeLocale, namespace: "brands" }),
    getTranslations({
      locale: safeLocale,
      namespace: "brands.verificationFilter",
    }),
    getMessages({ locale: safeLocale }),
  ]);

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
  const verificationFilter = filters.verificationFilter ?? "all";
  const shouldLoadTaxonomySummary = Boolean(singleValidCategory) && !search;
  const materials = filters.materials ?? [];

  const [{ brands, totalCount }, taxonomySummary, materialCounts] =
    await Promise.all([
      getPublicBrandCards({
        search: search || undefined,
        category: brandCategoryFilter,
        subcategoryTags: activeSubSlugs,
        materials: materials.length > 0 ? materials : undefined,
        verificationFilter,
        sort,
        page,
      }),
      shouldLoadTaxonomySummary && singleValidCategory
        ? getSubcategorySummary(singleValidCategory, activeSubcategory?.slug)
        : Promise.resolve({
            counts: new Map<string, number>(),
            latestUpdatedAt: null,
          }),
      // Same single cache entry as the L2 counts, so this costs no extra query.
      getMaterialCounts(),
    ]);
  const subcategoriesWithCounts = singleValidCategory
    ? L2_SUBCATEGORIES.filter(
        (subcategory) => subcategory.category === singleValidCategory,
      )
        .map((subcategory) => ({
          ...subcategory,
          count: taxonomySummary.counts.get(subcategory.slug) ?? 0,
        }))
        .filter((subcategory) => subcategory.count > 0)
    : [];
  const subcategoryOptions = subcategoriesWithCounts.map((subcategory) => ({
    slug: subcategory.slug,
    label: safeLocale === "zh-TW" ? subcategory.nameZh : subcategory.nameEn,
    count: subcategory.count,
  }));
  // Four material slugs are in the closed vocabulary with no brands behind them.
  // A rail entry that can only ever return an empty page is worse than no entry,
  // so the zero-count slugs are dropped here exactly as the L2 rail drops its own.
  // The label comes off the ontology, not a message catalogue: `?material=` and
  // `brands.material` both carry the slug, and the zh/en pair travels with it.
  const materialOptions = MATERIALS.map((material) => ({
    value: material.slug,
    label: safeLocale === "zh-TW" ? material.nameZh : material.nameEn,
    count: materialCounts.get(material.slug) ?? 0,
  })).filter((option) => option.count > 0);

  const totalPages = Math.ceil(totalCount / DEFAULT_PAGE_SIZE);
  const clampedPage = totalCount > 0 && page > totalPages ? totalPages : page;
  let displayBrands = brands;
  if (clampedPage !== page && totalCount > 0 && !isCategoryRoute) {
    const refetched = await getPublicBrandCards({
      search: search || undefined,
      category: brandCategoryFilter,
      subcategoryTags: activeSubSlugs,
      materials: materials.length > 0 ? materials : undefined,
      verificationFilter,
      sort,
      page: clampedPage,
    });
    displayBrands = refetched.brands;
  }

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
    materials,
    verificationFilter,
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
  for (const material of materials) {
    // `materials` carries slugs `parseDirectoryViewFilters` already gated
    // against `VALID_MATERIALS`, so the guard below is unreachable. It is the
    // same `continue` the category loop above uses rather than a second shape
    // for the same situation.
    const entry = materialBySlug(material);
    if (!entry) continue;
    const value = safeLocale === "zh-TW" ? entry.nameZh : entry.nameEn;
    const remainingMaterials = materials.filter((item) => item !== material);
    activeFilters.push({
      id: `material-${material}`,
      label: t("filters.activeMaterial"),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        material:
          remainingMaterials.length > 0 ? remainingMaterials.join(",") : null,
      }),
      removeLabel: t("filters.removeFilter", {
        label: t("filters.activeMaterial"),
        value,
      }),
    });
  }
  if (verificationFilter !== "all") {
    const value = verificationT(verificationFilter);
    activeFilters.push({
      id: "verification",
      label: t("filters.activeStatus"),
      value,
      removeHref: updateDirectoryUrl(directoryPath, normalizedParams, {
        verification: null,
      }),
      removeLabel: t("filters.removeFilter", {
        label: t("filters.activeStatus"),
        value,
      }),
    });
  }

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
      materials,
      verificationFilter,
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
                  routes.category(categoryTag.slug),
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

  const categoryBreadcrumb = categoryTag
    ? {
        slug: categoryTag.slug,
        label: categoryLabel(categoryTag, safeLocale),
      }
    : null;
  const subcategoryBreadcrumb = activeSubcategory
    ? {
        slug: activeSubcategory.slug,
        label:
          safeLocale === "zh-TW"
            ? activeSubcategory.nameZh
            : activeSubcategory.nameEn,
      }
    : null;

  return (
    <NextIntlClientProvider messages={messages}>
      {/* The shell is the shared grid too, not a formula that agrees with it by
          coincidence — the rail measure and the column gap both belong to the
          primitive, so a change to either moves every surface that uses it. */}
      <Grid
        as="main"
        cols="sidebar"
        className={cn(shellStyles({ measure: "page" }), "py-10")}
      >
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
        {/* `totalCount`, not `displayBrands.length` — the search matched that many,
            the page only renders one slice of them. */}
        <SearchResultsTracker query={search} resultCount={totalCount} />

        <aside className="hidden lg:block" aria-label={t("filters.title")}>
          <div className="sticky top-(--nav-height)">
            {/*
              `activeCategorySlugs` is SELECTION state, not a claim about what
              filters: the checked L1 is what opens its L2 rail, and unchecking
              it clears the pair. `?sub=` is only read alongside a single
              `?category=` (`seo/directory-filters.ts`), so there is no
              "subcategory without its L1" URL to preserve. What the L1 must not
              do is advertise itself as an applied filter — that is why the
              chips above and the count beside the box are both derived from
              what the brand query actually conjoins.
            */}
            <BrandFilterSidebar
              activeFilters={activeFilters}
              categories={[...L1_CATEGORIES]}
              activeCategorySlugs={validCategoryFilter}
              subcategories={subcategoryOptions}
              activeSubSlugs={activeSubSlugs}
              materials={materialOptions}
              activeMaterials={materials}
              announceSearchLoading={!isCategoryRoute}
              totalCount={totalCount}
            />
          </div>
        </aside>

        <div className="min-w-0">
          <DirectoryLandingHead
            locale={safeLocale}
            directoryLabel={t("heading")}
            category={categoryBreadcrumb}
            subcategory={subcategoryBreadcrumb}
            breadcrumbAria={t("breadcrumbAria")}
            pageHeading={pageHeading}
          />
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandFilterDrawer
                activeFilters={activeFilters}
                categories={[...L1_CATEGORIES]}
                activeCategorySlugs={validCategoryFilter}
                subcategories={subcategoryOptions}
                activeSubSlugs={activeSubSlugs}
                materials={materialOptions}
                activeMaterials={materials}
                announceSearchLoading={!isCategoryRoute}
                totalCount={totalCount}
              />
              <DirectoryResultStatus
                locale={safeLocale}
                totalCount={totalCount}
                latestUpdatedAt={latestUpdatedAt}
                announceLiveRegion={isCategoryRoute}
              />
            </div>
            <Suspense fallback={null}>
              <SortSelect />
            </Suspense>
          </div>

          <Suspense
            fallback={
              <Grid aria-label={t("loadingAria")}>
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={index}
                    className={surfaceCardStyles({ padding: "none" })}
                  >
                    <div className="aspect-media animate-pulse rounded-t-surface bg-surface" />
                    <div className="p-4">
                      <div className="h-4 animate-pulse rounded-surface bg-surface" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse rounded-surface bg-surface" />
                    </div>
                  </div>
                ))}
              </Grid>
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
        </div>
      </Grid>
    </NextIntlClientProvider>
  );
}
