import { getBrands, matchBrandsForQuery } from "@/lib/services/brands";
import type { BrandNameMatch } from "@/lib/brands/brand-name-match";
import { DiscoverBrandRow } from "@/components/products/discover-brand-row";
import {
  DiscoverEmptyRoutes,
  type DiscoverEmptyRouteTrail,
} from "@/components/products/discover-empty-routes";
import { DiscoverCategoryChips } from "@/components/products/discover-category-chips";
import { DiscoverTrailRail } from "@/components/products/discover-trail-rail";
import { parseDiscoverSource } from "@/lib/products/discover-search-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { captureReadFailure } from "@/lib/degraded-render";
import { ProductGrid } from "@/components/products/product-grid";
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
import { getAllTrails, type TrailEntry } from "@/lib/services/trails";
import { toTrailCard } from "@/lib/trails/trail-card";
import { routes } from "@/lib/routes";
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

/**
 * Trails offered as ways forward from a zero-result search, and in the
 * editorial rail above the unfiltered first page.
 */
const TRAIL_LIMIT = 3;

/**
 * The first few published trails, in the order the service returns them. A
 * failed read offers no trails rather than failing the page.
 */
async function readFirstTrails(locale: string): Promise<TrailEntry[]> {
  const result = await getAllTrails(locale === "en" ? "en" : "zh-TW");
  return result.ok ? result.trails.slice(0, TRAIL_LIMIT) : [];
}

/** Trails are zh-only today, so on /en a zh title carries its own `lang`. */
function toEmptyRouteTrail(
  trail: TrailEntry,
  locale: string,
): DiscoverEmptyRouteTrail {
  return {
    slug: trail.slug,
    title: trail.frontmatter.title,
    ...(locale === "en" && trail.frontmatter.locale !== "en"
      ? { lang: "zh-Hant-TW" }
      : {}),
  };
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
  const landingT = await getTranslations({ locale, namespace: "landing" });
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

  // Out-of-range pages 404, as an invalid category does (DS-34), rather than
  // a 200 that states a count above an empty grid. A zero-result first page
  // stays a 200 empty state, and so does a failed read (totalCount 0).
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  if (page > 1 && page > totalPages) {
    notFound();
  }

  const pageArmBySlot = armBySlot?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasChips = activeFilters.length > 0 || isSearchMode;

  // A zero-result search offers ways forward; the unfiltered first page opens
  // on an editorial trail rail. The trail read runs only for those two.
  const showSearchEmpty = isSearchMode && products.length === 0;
  // Narrowing cannot rescue a zero-result search with no filter applied, so
  // the empty state takes the full width instead of sitting beside facets.
  const showFilters = !(showSearchEmpty && activeFilters.length === 0);
  const showTrailRail =
    !isSearchMode &&
    category === null &&
    subcategories.length === 0 &&
    materials.length === 0 &&
    page === 1 &&
    products.length > 0;
  const firstTrails =
    showSearchEmpty || showTrailRail ? await readFirstTrails(locale) : [];
  // A zero-result product search still points at the brands that match the
  // same query (R2-02): /brands searches names and intros, not products.
  const brandMatchCount =
    showSearchEmpty && searchQuery
      ? await getBrands({ search: searchQuery })
          .then((result) => result.totalCount)
          .catch((error) => {
            captureReadFailure("discover.brandMatches")(error);
            return 0;
          })
      : 0;
  const brandMatch =
    brandMatchCount > 0 && searchQuery
      ? {
          href: routes.brands({ search: searchQuery }),
          label: t("search.emptyRoutes.brandMatches", {
            count: brandMatchCount,
            query: searchQuery,
          }),
        }
      : null;
  const emptyRouteTrails = showSearchEmpty
    ? firstTrails.map((trail) => toEmptyRouteTrail(trail, locale))
    : [];
  const railTrails = showTrailRail ? firstTrails.map(toTrailCard) : [];
  const emptyRouteCategories = showSearchEmpty
    ? VISIBLE_L1_CATEGORIES.map((node) => ({
        slug: node.slug,
        label: categoryLabel(node, locale),
      }))
    : [];

  // The header's intro line. Search mode echoes the query (clamped to one
  // line, the full text in `title`) before one count sentence: a pool-limited
  // count and a full one read the same, since both are relevance-ordered
  // results, never a claim that every item matches.
  const headerMeta = searchQuery !== null ? (
    <p className="flex min-w-0 items-baseline gap-x-2">
      <span className="min-w-0 truncate" title={searchQuery}>
        {t("search.queryEcho", { query: searchQuery })}
      </span>
      {totalCount > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {t("search.count", { count: totalCount })}
          </span>
        </>
      ) : null}
    </p>
  ) : (
    <p>{t("resultCount", { count: totalCount })}</p>
  );

  // The category chips: 全部 plus every visible L1. During a search each keeps
  // `q`, so changing the category refines the search instead of ending it.
  const categoryChips = [
    { slug: null, label: commonT("all") },
    ...VISIBLE_L1_CATEGORIES.map((node) => ({
      slug: node.slug,
      label: categoryLabel(node, locale),
    })),
  ].map((chip) => ({
    ...chip,
    href: routes.discover({
      category: chip.slug ?? undefined,
      q: searchQuery ?? undefined,
    }),
  }));

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        {/* Search mode titles the page 搜尋結果 (`products.search.heading`)
            and moves the query to the intro line: a long query at display
            size pushed the results below the fold. */}
        <DirectoryHeader
          title={isSearchMode ? t("search.heading") : t("heading")}
          lede={isSearchMode ? undefined : t("subheading")}
          meta={headerMeta}
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

        <ResultsTransitionProvider>
        <DiscoverCategoryChips
          label={t("filters.category")}
          chips={categoryChips}
          activeCategory={effectiveCategory}
        />

        {showTrailRail ? (
          <DiscoverTrailRail
            trails={railTrails}
            heading={t("trailRail.heading")}
            linkLabel={t("trailRail.linkText")}
            tileLabels={{
              eyebrow: landingT("trails.eyebrow"),
              cta: landingT("trails.cta"),
            }}
          />
        ) : null}

        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Desktop sidebar */}
          {showFilters ? (
            <FilterAside>
              <ProductFilterSidebar
                activeCategory={effectiveCategory}
                hideCounts={isSearchMode}
                subcategoryOptions={subcategoryOptions}
                activeSubSlugs={effectiveSubs}
                materialOptions={materialOptions}
                activeMaterials={effectiveMaterials}
                totalCount={totalCount}
              />
            </FilterAside>
          ) : null}

          <div className="min-w-0 flex-1">
            <DirectoryToolbar
              filterTrigger={
                showFilters ? (
                  <ProductFilterDrawer
                    activeCategory={effectiveCategory}
                    hideCounts={isSearchMode}
                    subcategoryOptions={subcategoryOptions}
                    activeSubSlugs={effectiveSubs}
                    materialOptions={materialOptions}
                    activeMaterials={effectiveMaterials}
                    totalCount={totalCount}
                  />
                ) : undefined
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
                  brandMatch={brandMatch}
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
      </div>
    </PageShell>
  );
}
