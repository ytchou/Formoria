import { matchBrandsForQuery } from "@/lib/services/brands";
import type { BrandNameMatch } from "@/lib/brands/brand-name-match";
import { DiscoverBrandRow } from "@/components/products/discover-brand-row";
import {
  DiscoverEmptyRoutes,
  type DiscoverEmptyRouteTrail,
} from "@/components/products/discover-empty-routes";
import { parseDiscoverSource } from "@/lib/products/discover-search-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { captureReadFailure } from "@/lib/degraded-render";
import { ProductGrid } from "@/components/products/product-grid";
import { SavedProductsProvider } from "@/hooks/use-saved-products";
import {
  ProductFilterSidebar,
  ProductFilterDrawer,
} from "@/components/products/product-filter-sidebar";
import {
  FilterAside,
  PendingResults,
  ResultsTransitionProvider,
} from "@/components/filters";
import { ProductSortSelect } from "@/components/products/product-sort-select";
import {
  ProductActiveFilters,
  type ActiveFilter,
} from "@/components/products/product-active-filters";
import { DiscoverUrlSync } from "@/components/products/discover-url-sync";
import { Pagination } from "@/components/brands/pagination";
import { buildAlternates } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import {
  getPublishedCuratedProducts,
  getProductFacetCounts,
  type CatalogProduct,
  type FacetCounts,
} from "@/lib/services/curated-products-catalog";
import {
  searchProductsBySituation,
  SituationQueryError,
  type SearchResult,
} from "@/lib/services/product-situation-search";
import { shouldAttemptIntentParse } from "@/lib/services/query-intent-parse";
import { getAllTrails } from "@/lib/services/trails";
import { createClient } from "@/lib/supabase/server";
import {
  VISIBLE_L1_CATEGORIES,
  categoryLabel,
  isMaterialApplicable,
  isVisibleCategory,
  subcategoryBySlug,
  subcategoryLabel,
  MATERIALS,
} from "@/lib/taxonomy/ontology";
import {
  parseDiscoverQuery,
  discoverMetadataFor,
  buildDiscoverSyncQuery,
  firstValue,
  hasInferParam,
  parseInferredFields,
  INFER_PARAM,
  INFERRED_PARAM,
  type DiscoverSort,
  type InferredField,
} from "@/lib/products/discover-search-params";
import { ProductSituationSearchForm } from "@/components/products/product-situation-search-form";
import { DirectoryHeader } from "@/components/directory/directory-header";
import { DirectoryToolbar } from "@/components/directory/directory-toolbar";
import { SearchResultsTracker } from "@/components/analytics/search-results-tracker";
import { DiscoverSearchClickTracker } from "@/components/analytics/discover-search-click-tracker";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

const PAGE_SIZE = 20;

/** Trails offered as ways forward from a zero-result search. */
const EMPTY_ROUTE_TRAIL_LIMIT = 3;

/**
 * The first few published trails, in the order the service returns them. A
 * failed read offers no trails rather than failing the page. Trails are
 * zh-only today, so on /en a zh title carries its own `lang`.
 */
async function readEmptyRouteTrails(
  locale: string,
): Promise<DiscoverEmptyRouteTrail[]> {
  const result = await getAllTrails(locale === "en" ? "en" : "zh-TW");
  if (!result.ok) return [];
  return result.trails.slice(0, EMPTY_ROUTE_TRAIL_LIMIT).map((trail) => ({
    slug: trail.slug,
    title: trail.frontmatter.title,
    ...(locale === "en" && trail.frontmatter.locale !== "en"
      ? { lang: "zh-Hant-TW" }
      : {}),
  }));
}

function firstParam(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value.at(0) : value;
  return candidate?.trim() || null;
}

function resolveDiscoverTaxonomy(
  rawParams: Record<string, string | string[] | undefined>,
): {
  category: string | null;
  subcategories: string[];
  materials: string[];
  sort: DiscoverSort;
  query: string | null;
} {
  const category = firstParam(rawParams.category);

  // Invalid category → 404
  if (category && !isVisibleCategory(category)) {
    notFound();
  }

  // Parse multi-select subcategories, silently drop invalid ones
  const rawSubs = parseCommaParam(rawParams.sub);
  const subcategories = category
    ? rawSubs.filter((slug) => {
        const node = subcategoryBySlug(slug);
        return node && node.category === category;
      })
    : [];

  // Parse materials, validate against closed vocabulary
  const validMaterialSlugs: ReadonlySet<string> = new Set(MATERIALS.map((m) => m.slug));
  const materials = parseCommaParam(rawParams.material).filter((slug) =>
    validMaterialSlugs.has(slug),
  );

  // Parse query + sort together (sort default depends on query presence)
  const { query, sort } = parseDiscoverQuery(rawParams);

  return { category, subcategories, materials, sort, query };
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const rawParams = await searchParams;
  const { category, query, materials } = resolveDiscoverTaxonomy(rawParams);
  const t = await getTranslations({ locale, namespace: "products" });

  const { robots, canonicalPath } = discoverMetadataFor({ query, category, materials });
  const { canonical, languages } = buildAlternates(
    canonicalPath,
    locale as "zh-TW" | "en",
  );
  const title = t("metaTitle");
  const description = t("metaDescription");
  const ogLocale = locale === "en" ? "en_US" : "zh_TW";
  const ogAlternateLocale = locale === "en" ? "zh_TW" : "en_US";

  return {
    title,
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
    ...(robots ? { robots } : {}),
  };
}

export default async function DiscoverPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const rawParams = await searchParams;
  const { category, subcategories, materials, sort, query: searchQuery } =
    resolveDiscoverTaxonomy(rawParams);
  const t = await getTranslations({ locale, namespace: "products" });
  const commonT = await getTranslations({ locale, namespace: "common" });
  const pageParam = firstParam(rawParams.page);
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  const isSearchMode = searchQuery !== null;

  // Intent parse gate: once per search-form submit (`infer=1`), only for
  // CJK-rich queries from authenticated users. Later loads of the same search
  // read the inferred filters back from the URL instead of re-parsing.
  //
  // Anonymous parse stays off (DEV-1964 decision). /discover?q= has no hard
  // per-visitor limit — only the soft `directory:search` traversal accounting
  // in src/lib/security/route-family.ts — the `infer=1` trigger is
  // client-settable, and each cache-miss parse is a paid Jev call with no
  // budget cap. DEV-1721 fixed the login gate as the cost control. Upgrade
  // path: a hard per-IP limiter on the parse trigger plus a daily call
  // budget, then open the parse to anonymous users.
  const inferTrigger = firstValue(rawParams[INFER_PARAM]) === "1";
  let enableIntentParse = false;
  if (
    inferTrigger &&
    searchQuery &&
    shouldAttemptIntentParse(searchQuery)
  ) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    enableIntentParse = !!user;
  }

  // Parallel fetch: products + facet counts
  let products: CatalogProduct[] = [];
  let totalCount = 0;
  let poolLimited = false;
  const searchSource = parseDiscoverSource(rawParams);
  let relatedBrands: BrandNameMatch[] = [];
  let degraded = false;
  let searchId: string | undefined;
  let intentParsed: 'skipped' | 'ok' | 'failed' = 'skipped';
  let intentCategory: string | null = null;
  let intentSubcategory: string | null = null;
  let intentMaterials: string[] = [];
  let intentCacheHit = false;
  let intentLatencyMs = 0;
  let appliedInference: SearchResult["appliedInference"] = {
    category: null,
    subcategory: null,
    materials: [],
  };
  let rpcLatencyMs = 0;
  let embedLatencyMs = 0;
  let ltrMode: string | undefined;
  let ltrLatencyMs: number | undefined;
  let featuresLatencyMs: number | undefined;
  let ltrScores: number[] | undefined;
  let ltrRanks: number[] | undefined;
  let ltrProductKeys: string[] | undefined;
  let rrfProductKeys: string[] | undefined;
  let armBySlot: ('rrf' | 'ltr')[] | undefined;
  let facets: FacetCounts = {
    categoryCounts: [],
    subcategoryCounts: [],
    materialCounts: [],
  };
  // Category counts never narrow to the active category, so they come from
  // the unfiltered facets. Shortcut: a second facet read (all categories)
  // whenever a category is active. Ceiling: fine while the unfiltered read is
  // an `unstable_cache` hit (1h revalidate) over a corpus of a few thousand
  // rows, aggregated in memory. Upgrade path, once cold-cache facet latency
  // shows up on /discover: one read that returns both scopes.
  // Failure omits the counts (null) rather than failing the page.
  const readUnfilteredFacets = () =>
    getProductFacetCounts(null).catch((err) => {
      captureReadFailure("discover.facets")(err);
      return null;
    });
  // A URL category is known now, so its unfiltered read runs beside the main
  // reads. Only a category inferred by the search has to wait for it.
  const urlCategoryUnfilteredFacets = category
    ? readUnfilteredFacets()
    : undefined;
  try {
    if (isSearchMode) {
      const [searchResult, facetResult, brandMatches] = await Promise.all([
        searchProductsBySituation({
          query: searchQuery,
          locale: locale as "zh-TW" | "en",
          sort,
          category,
          subcategories: subcategories.length > 0 ? subcategories : undefined,
          materials: materials.length > 0 ? materials : undefined,
          page,
          pageSize: PAGE_SIZE,
          enableIntentParse,
        }),
        getProductFacetCounts(category),
        page === 1 ? matchBrandsForQuery(searchQuery).catch(error => {
          captureReadFailure("discover.brands")(error);
          return [];
        }) : Promise.resolve([]),
      ]);
      products = searchResult.products;
      totalCount = searchResult.totalCount;
      poolLimited = searchResult.poolLimited;
      relatedBrands = brandMatches;
      degraded = searchResult.degraded;
      searchId = searchResult.searchId;
      intentParsed = searchResult.intentParsed;
      intentCategory = searchResult.intentCategory;
      intentSubcategory = searchResult.intentSubcategory;
      intentMaterials = searchResult.intentMaterials;
      intentCacheHit = searchResult.intentCacheHit;
      intentLatencyMs = searchResult.intentLatencyMs;
      appliedInference = searchResult.appliedInference;
      rpcLatencyMs = searchResult.rpcLatencyMs;
      embedLatencyMs = searchResult.embedLatencyMs;
      ltrMode = searchResult.ltrMode;
      ltrLatencyMs = searchResult.ltrLatencyMs;
      featuresLatencyMs = searchResult.featuresLatencyMs;
      ltrScores = searchResult.ltrScores;
      ltrRanks = searchResult.ltrRanks;
      ltrProductKeys = searchResult.ltrProductKeys;
      rrfProductKeys = searchResult.rrfProductKeys;
      armBySlot = searchResult.armBySlot;
      facets = facetResult;
      // An inferred category changes which subcategory facets apply.
      if (appliedInference.category && appliedInference.category !== category) {
        facets = await getProductFacetCounts(appliedInference.category);
      }
    } else {
      // In catalog mode, sort is never "relevance" (parseDiscoverQuery guarantees this)
      const catalogSort = sort as "newest" | "alphabetical";
      const [productResult, facetResult] = await Promise.all([
        getPublishedCuratedProducts({
          category,
          // The unfiltered listing counts only visible L1s, matching the
          // sidebar's all-categories total.
          ...(category
            ? {}
            : { categories: VISIBLE_L1_CATEGORIES.map((c) => c.slug) }),
          subcategories: subcategories.length > 0 ? subcategories : undefined,
          materials: materials.length > 0 ? materials : undefined,
          sort: catalogSort,
          page,
          pageSize: PAGE_SIZE,
        }),
        getProductFacetCounts(category),
      ]);
      products = productResult.products;
      totalCount = productResult.totalCount;
      facets = facetResult;
    }
  } catch (err) {
    // A rejected query (e.g. one character from the GET form) is visitor
    // input, not a failed read: render the empty result without an alert.
    if (!(err instanceof SituationQueryError)) {
      captureReadFailure("discover.catalog")(err);
    }
  }

  // Effective filters: the URL's own values plus what the search inferred.
  const effectiveCategory = category ?? appliedInference.category;
  const effectiveSubs = subcategories.length
    ? subcategories
    : appliedInference.subcategory
      ? [appliedInference.subcategory]
      : [];
  const effectiveMaterials = materials.length
    ? materials
    : appliedInference.materials;
  // Fields marked inferred: those this request filled in, plus those an
  // earlier synced URL already marked (reloads and paging skip the parse).
  const inferredFields: InferredField[] = [
    ...parseInferredFields(rawParams[INFERRED_PARAM]),
    ...(appliedInference.category ? (["category"] as const) : []),
    ...(appliedInference.subcategory ? (["sub"] as const) : []),
    ...(appliedInference.materials.length ? (["material"] as const) : []),
  ];

  // Subcategory options for the sidebar: the active category's subs, or every
  // visible category's subs under 全部 (facets are unfiltered then). Each
  // carries its parent so checking one with no category can scope the URL.
  const subcategoryOptions = facets.subcategoryCounts.flatMap((fc) => {
    const node = subcategoryBySlug(fc.slug);
    if (!node) return [];
    if (effectiveCategory
      ? node.category !== effectiveCategory
      : !isVisibleCategory(node.category)) {
      return [];
    }
    return [
      {
        slug: fc.slug,
        label: subcategoryLabel(node, locale),
        count: fc.count,
        category: node.category,
      },
    ];
  });

  const unfilteredFacets = effectiveCategory
    ? await (urlCategoryUnfilteredFacets ?? readUnfilteredFacets())
    : facets;
  // Null or empty means a read failed: omit counts rather than show a column
  // of 0s.
  const categoryCounts =
    unfilteredFacets && unfilteredFacets.categoryCounts.length > 0
      ? Object.fromEntries(
          unfilteredFacets.categoryCounts.map((fc) => [fc.slug, fc.count]),
        )
      : undefined;

  // Build material options (filter count > 0, only for applicable L1s)
  const materialOptions = isMaterialApplicable(effectiveCategory)
    ? facets.materialCounts
        .filter((fc) => fc.count > 0)
        .map((fc) => {
          const mat = MATERIALS.find((m) => m.slug === fc.slug);
          return {
            value: fc.slug,
            label: mat
              ? locale === "zh-TW"
                ? mat.nameZh
                : mat.nameEn
              : fc.slug,
            count: fc.count,
          };
        })
    : [];

  // Build active filters for chips. The category chip exists only in search
  // mode; in browse mode the category is the page's position, not a filter.
  const activeCategoryNode =
    isSearchMode && effectiveCategory
      ? VISIBLE_L1_CATEGORIES.find((c) => c.slug === effectiveCategory)
      : undefined;
  // `inferred` comes from the server-side list, so the 自動判斷 badge is in
  // the first HTML rather than waiting for the client URL sync.
  const activeFilters: ActiveFilter[] = [
    ...(activeCategoryNode
      ? [
          {
            type: "category" as const,
            slug: activeCategoryNode.slug,
            label: categoryLabel(activeCategoryNode, locale),
            inferred: inferredFields.includes("category"),
          },
        ]
      : []),
    ...effectiveSubs.map((slug) => {
      const node = subcategoryBySlug(slug);
      return {
        type: "subcategory" as const,
        slug,
        label: node ? subcategoryLabel(node, locale) : slug,
        inferred: inferredFields.includes("sub"),
      };
    }),
    ...effectiveMaterials.map((slug) => {
      const mat = MATERIALS.find((m) => m.slug === slug);
      return {
        type: "material" as const,
        slug,
        label: mat
          ? locale === "zh-TW"
            ? mat.nameZh
            : mat.nameEn
          : slug,
        inferred: inferredFields.includes("material"),
      };
    }),
  ];

  const pageArmBySlot = armBySlot?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasChips = activeFilters.length > 0 || isSearchMode;

  // A zero-result search offers ways forward; the trail read runs only then.
  const showSearchEmpty = isSearchMode && products.length === 0;
  const emptyRouteTrails = showSearchEmpty
    ? await readEmptyRouteTrails(locale)
    : [];
  const emptyRouteCategories = showSearchEmpty
    ? VISIBLE_L1_CATEGORIES.map((node) => ({
        slug: node.slug,
        label: categoryLabel(node, locale),
      }))
    : [];

  // Search-mode result line. A pool-limited count is the size of the ranked
  // candidate pool, not a match count, so it is worded as a top-N.
  const searchIntro =
    totalCount === 0
      ? undefined
      : poolLimited
        ? t("search.countTop", { count: totalCount })
        : t("search.count", { count: totalCount });

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        {/* Search mode titles the page by the query. Safe as the h1 because
            every `?q` page is noindex (`discoverMetadataFor`). */}
        <DirectoryHeader
          title={
            isSearchMode
              ? t("search.resultsHeading", { query: searchQuery })
              : t("heading")
          }
          intro={isSearchMode ? searchIntro : t("subheading")}
          search={
            <ProductSituationSearchForm
              locale={locale}
              query={searchQuery}
              labels={{
                label: t("search.label"),
                placeholder: t("search.placeholder"),
                submit: t("search.submit"),
                clear: t("search.clear"),
              }}
            />
          }
        />

        {/* Writes the effective filters into the address bar; also strips the
            one-time infer flag (any value, not only the parse trigger). */}
        {(isSearchMode || hasInferParam(rawParams) || rawParams.src !== undefined) && (
          <DiscoverUrlSync
            search={buildDiscoverSyncQuery(
              rawParams,
              {
                category: effectiveCategory,
                subcategories: effectiveSubs,
                materials: effectiveMaterials,
              },
              inferredFields,
            )}
          />
        )}

        <SavedProductsProvider>
        <ResultsTransitionProvider>
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Desktop sidebar */}
          <FilterAside>
            <ProductFilterSidebar
              locale={locale}
              activeCategory={effectiveCategory}
              allLabel={commonT("all")}
              categoryCounts={categoryCounts}
              subcategoryOptions={subcategoryOptions}
              activeSubSlugs={effectiveSubs}
              materialOptions={materialOptions}
              activeMaterials={effectiveMaterials}
              totalCount={totalCount}
            />
          </FilterAside>

          <div className="min-w-0 flex-1">
            <DirectoryToolbar
              filterTrigger={
                <ProductFilterDrawer
                  locale={locale}
                  activeCategory={effectiveCategory}
                  allLabel={commonT("all")}
                  categoryCounts={categoryCounts}
                  subcategoryOptions={subcategoryOptions}
                  activeSubSlugs={effectiveSubs}
                  materialOptions={materialOptions}
                  activeMaterials={effectiveMaterials}
                  totalCount={totalCount}
                />
              }
              // Search mode states the count in the intro (`search.count` or
              // `search.countTop`); a second one here would repeat it.
              count={
                isSearchMode ? undefined : (
                  <p>{t("resultCount", { count: totalCount })}</p>
                )
              }
              chips={
                hasChips ? (
                  <ProductActiveFilters
                    activeFilters={activeFilters}
                    query={searchQuery}
                  />
                ) : undefined
              }
              sort={
                totalCount > 0 ? (
                  <ProductSortSelect
                    currentSort={sort}
                    showRelevance={isSearchMode}
                  />
                ) : undefined
              }
            />

            {isSearchMode && (
              <SearchResultsTracker
                trackerKind="product"
                query={searchQuery}
                resultCount={totalCount}
                searchId={searchId}
                productKeys={products.map((p) => p.key)}
                searchSource={searchSource}
                degraded={degraded}
                intentParsed={intentParsed}
                intentCategory={intentCategory}
                intentSubcategory={intentSubcategory}
                intentMaterials={intentMaterials}
                intentCacheHit={intentCacheHit}
                intentLatencyMs={intentLatencyMs}
                rpcLatencyMs={rpcLatencyMs}
                embedLatencyMs={embedLatencyMs}
                ltrMode={ltrMode}
                ltrLatencyMs={ltrLatencyMs}
                featuresLatencyMs={featuresLatencyMs}
                ltrScores={ltrScores}
                ltrRanks={ltrRanks}
                ltrProductKeys={ltrProductKeys}
                rrfProductKeys={rrfProductKeys}
                armBySlot={armBySlot}
              />
            )}

            <PendingResults>
            {isSearchMode && searchId && page === 1 && (
              <DiscoverBrandRow brands={relatedBrands} heading={t("brandRow.heading")} query={searchQuery} searchId={searchId} />
            )}

            {showSearchEmpty ? (
              // EmptyState takes a single action by contract, so the forward
              // routes render beside it, inside the same empty-state block.
              <div data-empty className="space-y-8">
                <EmptyState
                  icon={<PackageOpen />}
                  title={t("search.empty", { query: searchQuery })}
                />
                <DiscoverEmptyRoutes
                  trails={emptyRouteTrails}
                  categories={emptyRouteCategories}
                  trailsHeading={t("search.emptyRoutes.trailsHeading")}
                  categoriesHeading={t("search.emptyRoutes.categoriesHeading")}
                />
              </div>
            ) : products.length === 0 ? (
              <EmptyState icon={<PackageOpen />} title={t("emptyState")} />
            ) : (
              <>
                {isSearchMode && searchId ? (
                  <DiscoverSearchClickTracker
                    searchId={searchId}
                    query={searchQuery!}
                    armBySlot={pageArmBySlot}
                    ltrMode={ltrMode}
                  >
                    <ProductGrid products={products} locale={locale} />
                  </DiscoverSearchClickTracker>
                ) : (
                  <ProductGrid products={products} locale={locale} />
                )}
                <Pagination
                  totalCount={totalCount}
                  currentPage={page}
                  pageSize={PAGE_SIZE}
                />
              </>
            )}
            </PendingResults>
          </div>
        </div>
        </ResultsTransitionProvider>
        </SavedProductsProvider>
      </div>
    </PageShell>
  );
}
