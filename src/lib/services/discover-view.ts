import type { BrandNameMatch } from "@/lib/brands/brand-name-match";
import { captureReadFailure } from "@/lib/degraded-render";
import {
  INFER_PARAM,
  INFERRED_PARAM,
  firstValue,
  parseDiscoverSource,
  parseInferredFields,
  type DiscoverSort,
  type InferredField,
} from "@/lib/products/discover-search-params";
import { getBrands, matchBrandsForQuery } from "@/lib/services/brands";
import {
  getProductFacetCounts,
  getPublishedCuratedProducts,
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
import {
  MATERIALS,
  VISIBLE_L1_CATEGORIES,
  categoryLabel,
  isMaterialApplicable,
  isVisibleCategory,
  subcategoryBySlug,
  subcategoryLabel,
} from "@/lib/taxonomy/ontology";
import { toTrailCard, type TrailCard } from "@/lib/trails/trail-card";

/**
 * The /discover view model: everything the page renders, read and decided
 * here so the page only lays it out.
 */

type RawParamValue = string | string[] | undefined;
type RawSearchParams = Record<string, RawParamValue>;

const DISCOVER_PAGE_SIZE = 20;

/**
 * Trails offered as ways forward from a zero-result search, and in the
 * editorial rail above the unfiltered first page.
 */
const TRAIL_LIMIT = 3;

/** The page's validated URL filters (see `resolveDiscoverTaxonomy` in the page). */
export type DiscoverTaxonomy = {
  category: string | null;
  subcategories: string[];
  materials: string[];
  sort: DiscoverSort;
  query: string | null;
};

export type AppliedInference = SearchResult["appliedInference"];

export type DiscoverFilters = {
  category: string | null;
  subcategories: string[];
  materials: string[];
};

export type DiscoverSubcategoryOption = {
  slug: string;
  label: string;
  count: number;
  category: string;
};

export type DiscoverMaterialOption = { value: string; label: string; count: number };

/** Structurally the `ActiveFilter` the chips component takes. */
export type DiscoverActiveFilter = {
  type: "category" | "subcategory" | "material";
  slug: string;
  label: string;
  inferred: boolean;
};

/** Structurally the `DiscoverEmptyRouteTrail` the empty-routes component takes. */
export type DiscoverEmptyRouteTrail = { slug: string; title: string; lang?: string };

/**
 * The search telemetry `SearchResultsTracker` reports. Field names match the
 * tracker's props exactly so the page spreads the object; a new field is one
 * line here plus one line in `buildSearchTelemetry`.
 */
export type SearchTelemetry = {
  query: string;
  resultCount: number;
  searchId: string | undefined;
  productKeys: string[];
  searchSource: string;
  degraded: boolean;
  intentParsed: SearchResult["intentParsed"];
  intentCategory: string | null;
  intentSubcategory: string | null;
  intentMaterials: string[];
  intentCacheHit: boolean;
  intentLatencyMs: number;
  rpcLatencyMs: number;
  embedLatencyMs: number;
  ltrMode: string | undefined;
  ltrLatencyMs: number | undefined;
  featuresLatencyMs: number | undefined;
  ltrScores: number[] | undefined;
  ltrRanks: number[] | undefined;
  ltrProductKeys: string[] | undefined;
  rrfProductKeys: string[] | undefined;
  armBySlot: SearchResult["armBySlot"];
};

export type DiscoverSurfaces = {
  showSearchEmpty: boolean;
  showFilters: boolean;
  showTrailRail: boolean;
  hasChips: boolean;
};

type DiscoverViewModel = DiscoverSurfaces & {
  outOfRange: false;
  page: number;
  pageSize: number;
  sort: DiscoverSort;
  isSearchMode: boolean;
  searchQuery: string | null;
  products: CatalogProduct[];
  totalCount: number;
  effectiveFilters: DiscoverFilters;
  inferredFields: InferredField[];
  subcategoryOptions: DiscoverSubcategoryOption[];
  materialOptions: DiscoverMaterialOption[];
  activeFilters: DiscoverActiveFilter[];
  relatedBrands: BrandNameMatch[];
  searchId: string | undefined;
  ltrMode: string | undefined;
  pageArmBySlot: SearchResult["armBySlot"];
  railTrails: TrailCard[];
  emptyRouteTrails: DiscoverEmptyRouteTrail[];
  emptyRouteCategories: { slug: string; label: string }[];
  /** Brands matching a zero-result query; 0 outside the search empty state. */
  brandMatchCount: number;
  telemetry: SearchTelemetry;
};

/** A page past the last one: the page calls `notFound()`. */
export type DiscoverView = DiscoverViewModel | { outOfRange: true };

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

function firstTrimmed(value: RawParamValue): string | null {
  const candidate = Array.isArray(value) ? value.at(0) : value;
  return candidate?.trim() || null;
}

export function parseDiscoverPage(value: RawParamValue): number {
  const pageParam = firstTrimmed(value);
  return pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;
}

/**
 * Whether this request asks for an intent parse: once per search-form submit
 * (`infer=1`), only for CJK-rich queries. Later loads of the same search read
 * the inferred filters back from the URL instead of re-parsing. The page
 * resolves the viewer only when this is true.
 */
export function isIntentParseRequested(
  rawParams: RawSearchParams,
  query: string | null,
): boolean {
  return (
    firstValue(rawParams[INFER_PARAM]) === "1" &&
    !!query &&
    shouldAttemptIntentParse(query)
  );
}

/**
 * Intent parse gate: a requested parse runs only for authenticated users.
 *
 * Anonymous parse stays off (DEV-1964 decision). /discover?q= has no hard
 * per-visitor limit — only the soft `directory:search` traversal accounting
 * in src/lib/security/route-family.ts — the `infer=1` trigger is
 * client-settable, and each cache-miss parse is a paid Jev call with no
 * budget cap. DEV-1721 fixed the login gate as the cost control. Upgrade
 * path: a hard per-IP limiter on the parse trigger plus a daily call
 * budget, then open the parse to anonymous users.
 */
export function shouldParseIntent(
  rawParams: RawSearchParams,
  query: string | null,
  isAuthenticated: boolean,
): boolean {
  return isAuthenticated && isIntentParseRequested(rawParams, query);
}

/** Effective filters: the URL's own values, else what the search inferred. */
export function mergeEffectiveFilters(
  url: DiscoverFilters,
  inference: AppliedInference,
): DiscoverFilters {
  return {
    category: url.category ?? inference.category,
    subcategories: url.subcategories.length
      ? url.subcategories
      : inference.subcategory
        ? [inference.subcategory]
        : [],
    materials: url.materials.length ? url.materials : inference.materials,
  };
}

/**
 * Fields marked inferred: those an earlier synced URL already marked (reloads
 * and paging skip the parse), plus those this request filled in.
 */
export function buildInferredFields(
  rawInferred: RawParamValue,
  inference: AppliedInference,
): InferredField[] {
  return [
    ...parseInferredFields(rawInferred),
    ...(inference.category ? (["category"] as const) : []),
    ...(inference.subcategory ? (["sub"] as const) : []),
    ...(inference.materials.length ? (["material"] as const) : []),
  ];
}

/**
 * Subcategory options for the sidebar: the active category's subs, or every
 * visible category's subs under 全部 (facets are unfiltered then). Each
 * carries its parent so checking one with no category can scope the URL.
 */
export function buildSubcategoryOptions(
  subcategoryCounts: FacetCounts["subcategoryCounts"],
  effectiveCategory: string | null,
  locale: string,
): DiscoverSubcategoryOption[] {
  return subcategoryCounts.flatMap((fc) => {
    const node = subcategoryBySlug(fc.slug);
    if (!node) return [];
    if (
      effectiveCategory
        ? node.category !== effectiveCategory
        : !isVisibleCategory(node.category)
    ) {
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
}

function materialLabel(slug: string, locale: string): string {
  const mat = MATERIALS.find((m) => m.slug === slug);
  return mat ? (locale === "zh-TW" ? mat.nameZh : mat.nameEn) : slug;
}

/** Material options: counts above zero, only for applicable L1s. */
export function buildMaterialOptions(
  materialCounts: FacetCounts["materialCounts"],
  effectiveCategory: string | null,
  locale: string,
): DiscoverMaterialOption[] {
  return isMaterialApplicable(effectiveCategory)
    ? materialCounts
        .filter((fc) => fc.count > 0)
        .map((fc) => ({
          value: fc.slug,
          label: materialLabel(fc.slug, locale),
          count: fc.count,
        }))
    : [];
}

/**
 * Active filter chips. The category chip exists only in search mode; in
 * browse mode the category is the page's position, not a filter. `inferred`
 * comes from the server-side list, so the 自動判斷 badge is in the first HTML
 * rather than waiting for the client URL sync.
 */
export function buildActiveFilters({
  isSearchMode,
  effective,
  inferredFields,
  locale,
}: {
  isSearchMode: boolean;
  effective: DiscoverFilters;
  inferredFields: readonly InferredField[];
  locale: string;
}): DiscoverActiveFilter[] {
  const activeCategoryNode =
    isSearchMode && effective.category
      ? VISIBLE_L1_CATEGORIES.find((c) => c.slug === effective.category)
      : undefined;
  return [
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
    ...effective.subcategories.map((slug) => {
      const node = subcategoryBySlug(slug);
      return {
        type: "subcategory" as const,
        slug,
        label: node ? subcategoryLabel(node, locale) : slug,
        inferred: inferredFields.includes("sub"),
      };
    }),
    ...effective.materials.map((slug) => ({
      type: "material" as const,
      slug,
      label: materialLabel(slug, locale),
      inferred: inferredFields.includes("material"),
    })),
  ];
}

/**
 * Out-of-range pages 404, as an invalid category does (DS-34), rather than a
 * 200 that states a count above an empty grid. A zero-result first page stays
 * a 200 empty state, and so does a failed read (totalCount 0).
 */
export function isPageOutOfRange(
  page: number,
  totalCount: number,
  pageSize: number,
): boolean {
  return page > 1 && page > Math.ceil(totalCount / pageSize);
}

/** The interleaving arm of each slot on the current page. */
export function sliceArmBySlot(
  armBySlot: SearchResult["armBySlot"],
  page: number,
  pageSize: number,
): SearchResult["armBySlot"] {
  return armBySlot?.slice((page - 1) * pageSize, page * pageSize);
}

/**
 * A zero-result search offers ways forward; the unfiltered first page opens
 * on an editorial trail rail. Narrowing cannot rescue a zero-result search
 * with no filter applied, so the empty state then takes the full width
 * instead of sitting beside facets.
 */
export function decideDiscoverSurfaces({
  isSearchMode,
  url,
  page,
  productCount,
  activeFilterCount,
}: {
  isSearchMode: boolean;
  url: DiscoverFilters;
  page: number;
  productCount: number;
  activeFilterCount: number;
}): DiscoverSurfaces {
  const showSearchEmpty = isSearchMode && productCount === 0;
  return {
    showSearchEmpty,
    showFilters: !(showSearchEmpty && activeFilterCount === 0),
    showTrailRail:
      !isSearchMode &&
      url.category === null &&
      url.subcategories.length === 0 &&
      url.materials.length === 0 &&
      page === 1 &&
      productCount > 0,
    hasChips: activeFilterCount > 0 || isSearchMode,
  };
}

/** Trails are zh-only today, so on /en a zh title carries its own `lang`. */
export function toEmptyRouteTrail(
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

export function buildSearchTelemetry({
  query,
  search,
  products,
  totalCount,
  searchSource,
}: {
  query: string;
  search: SearchResult | null;
  products: CatalogProduct[];
  totalCount: number;
  searchSource: string;
}): SearchTelemetry {
  return {
    query,
    resultCount: totalCount,
    searchId: search?.searchId,
    productKeys: products.map((p) => p.key),
    searchSource,
    degraded: search?.degraded ?? false,
    intentParsed: search?.intentParsed ?? "skipped",
    intentCategory: search?.intentCategory ?? null,
    intentSubcategory: search?.intentSubcategory ?? null,
    intentMaterials: search?.intentMaterials ?? [],
    intentCacheHit: search?.intentCacheHit ?? false,
    intentLatencyMs: search?.intentLatencyMs ?? 0,
    rpcLatencyMs: search?.rpcLatencyMs ?? 0,
    embedLatencyMs: search?.embedLatencyMs ?? 0,
    ltrMode: search?.ltrMode,
    ltrLatencyMs: search?.ltrLatencyMs,
    featuresLatencyMs: search?.featuresLatencyMs,
    ltrScores: search?.ltrScores,
    ltrRanks: search?.ltrRanks,
    ltrProductKeys: search?.ltrProductKeys,
    rrfProductKeys: search?.rrfProductKeys,
    armBySlot: search?.armBySlot,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type DiscoverResults = {
  products: CatalogProduct[];
  totalCount: number;
  facets: FacetCounts;
  relatedBrands: BrandNameMatch[];
  /** The search result in search mode; null in catalog mode or on failure. */
  search: SearchResult | null;
};

const NO_INFERENCE: AppliedInference = {
  category: null,
  subcategory: null,
  materials: [],
};

const EMPTY_RESULTS: DiscoverResults = {
  products: [],
  totalCount: 0,
  facets: { categoryCounts: [], subcategoryCounts: [], materialCounts: [] },
  relatedBrands: [],
  search: null,
};

/** Search or catalog products plus facet counts, run in parallel. */
async function readResults(
  taxonomy: DiscoverTaxonomy,
  locale: string,
  page: number,
  enableIntentParse: boolean,
): Promise<DiscoverResults> {
  const { category, subcategories, materials, sort, query } = taxonomy;
  // Assigned in stages so a failed facet re-read keeps the search it followed.
  let results = EMPTY_RESULTS;
  try {
    if (query !== null) {
      const [search, facets, relatedBrands] = await Promise.all([
        searchProductsBySituation({
          query,
          locale: locale as "zh-TW" | "en",
          sort,
          category,
          subcategories: subcategories.length > 0 ? subcategories : undefined,
          materials: materials.length > 0 ? materials : undefined,
          page,
          pageSize: DISCOVER_PAGE_SIZE,
          enableIntentParse,
        }),
        getProductFacetCounts(category),
        page === 1
          ? matchBrandsForQuery(query).catch((error) => {
              captureReadFailure("discover.brands")(error);
              return [];
            })
          : Promise.resolve([]),
      ]);
      results = {
        products: search.products,
        totalCount: search.totalCount,
        facets,
        relatedBrands,
        search,
      };
      // An inferred category changes which subcategory facets apply.
      const inferred = search.appliedInference.category;
      if (inferred && inferred !== category) {
        results = { ...results, facets: await getProductFacetCounts(inferred) };
      }
    } else {
      // In catalog mode, sort is never "relevance" (parseDiscoverQuery guarantees this)
      const catalogSort = sort as "newest" | "alphabetical";
      const [productResult, facets] = await Promise.all([
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
          pageSize: DISCOVER_PAGE_SIZE,
        }),
        getProductFacetCounts(category),
      ]);
      results = {
        ...EMPTY_RESULTS,
        products: productResult.products,
        totalCount: productResult.totalCount,
        facets,
      };
    }
  } catch (err) {
    // A rejected query (e.g. one character from the GET form) is visitor
    // input, not a failed read: render the empty result without an alert.
    if (!(err instanceof SituationQueryError)) {
      captureReadFailure("discover.catalog")(err);
    }
  }
  return results;
}

/**
 * The first few published trails, in the order the service returns them. A
 * failed read offers no trails rather than failing the page.
 */
async function readFirstTrails(locale: string): Promise<TrailEntry[]> {
  const result = await getAllTrails(locale === "en" ? "en" : "zh-TW");
  return result.ok ? result.trails.slice(0, TRAIL_LIMIT) : [];
}

/**
 * A zero-result product search still points at the brands that match the
 * same query (R2-02): /brands searches names and intros, not products.
 */
async function readBrandMatchCount(query: string): Promise<number> {
  return getBrands({ search: query })
    .then((result) => result.totalCount)
    .catch((error) => {
      captureReadFailure("discover.brandMatches")(error);
      return 0;
    });
}

export async function loadDiscoverView({
  rawParams,
  taxonomy,
  locale,
  isAuthenticated,
}: {
  rawParams: RawSearchParams;
  taxonomy: DiscoverTaxonomy;
  locale: string;
  isAuthenticated: boolean;
}): Promise<DiscoverView> {
  const { query: searchQuery } = taxonomy;
  const page = parseDiscoverPage(rawParams.page);
  const isSearchMode = searchQuery !== null;
  const enableIntentParse = shouldParseIntent(rawParams, searchQuery, isAuthenticated);

  const results = await readResults(taxonomy, locale, page, enableIntentParse);
  const { products, totalCount, facets, search } = results;
  const inference = search?.appliedInference ?? NO_INFERENCE;

  const effectiveFilters = mergeEffectiveFilters(taxonomy, inference);
  const inferredFields = buildInferredFields(rawParams[INFERRED_PARAM], inference);
  const activeFilters = buildActiveFilters({
    isSearchMode,
    effective: effectiveFilters,
    inferredFields,
    locale,
  });

  // Checked before the trail and brand reads, which a 404 never needs.
  if (isPageOutOfRange(page, totalCount, DISCOVER_PAGE_SIZE)) {
    return { outOfRange: true };
  }

  const surfaces = decideDiscoverSurfaces({
    isSearchMode,
    url: taxonomy,
    page,
    productCount: products.length,
    activeFilterCount: activeFilters.length,
  });
  const { showSearchEmpty, showTrailRail } = surfaces;
  // The trail read runs only for the search empty state and the rail.
  const firstTrails =
    showSearchEmpty || showTrailRail ? await readFirstTrails(locale) : [];
  const brandMatchCount =
    showSearchEmpty && searchQuery ? await readBrandMatchCount(searchQuery) : 0;

  return {
    outOfRange: false,
    ...surfaces,
    page,
    pageSize: DISCOVER_PAGE_SIZE,
    sort: taxonomy.sort,
    isSearchMode,
    searchQuery,
    products,
    totalCount,
    effectiveFilters,
    inferredFields,
    subcategoryOptions: buildSubcategoryOptions(
      facets.subcategoryCounts,
      effectiveFilters.category,
      locale,
    ),
    materialOptions: buildMaterialOptions(
      facets.materialCounts,
      effectiveFilters.category,
      locale,
    ),
    activeFilters,
    relatedBrands: results.relatedBrands,
    searchId: search?.searchId,
    ltrMode: search?.ltrMode,
    pageArmBySlot: sliceArmBySlot(search?.armBySlot, page, DISCOVER_PAGE_SIZE),
    railTrails: showTrailRail ? firstTrails.map(toTrailCard) : [],
    emptyRouteTrails: showSearchEmpty
      ? firstTrails.map((trail) => toEmptyRouteTrail(trail, locale))
      : [],
    emptyRouteCategories: showSearchEmpty
      ? VISIBLE_L1_CATEGORIES.map((node) => ({
          slug: node.slug,
          label: categoryLabel(node, locale),
        }))
      : [],
    brandMatchCount,
    telemetry: buildSearchTelemetry({
      query: searchQuery ?? "",
      search,
      products,
      totalCount,
      searchSource: parseDiscoverSource(rawParams),
    }),
  };
}
