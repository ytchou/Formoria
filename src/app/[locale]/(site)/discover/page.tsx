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
import { ProductSortSelect } from "@/components/products/product-sort-select";
import { ProductActiveFilters } from "@/components/products/product-active-filters";
import { Pagination } from "@/components/brands/pagination";
import { buildAlternates } from "@/lib/seo/alternates";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import {
  getPublishedCuratedProducts,
  getProductFacetCounts,
  type CatalogProduct,
} from "@/lib/services/curated-products-catalog";
import { searchProductsBySituation } from "@/lib/services/product-situation-search";
import {
  isVisibleCategory,
  subcategoryBySlug,
  subcategoryLabel,
  MATERIALS,
} from "@/lib/taxonomy/ontology";
import {
  parseDiscoverQuery,
  discoverMetadataFor,
  type DiscoverSort,
} from "@/lib/products/discover-search-params";
import { ProductSituationSearchForm } from "@/components/products/product-situation-search-form";
import { SearchResultsTracker } from "@/components/analytics/search-results-tracker";

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 3600;

const PAGE_SIZE = 12;

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
  const { category, query } = resolveDiscoverTaxonomy(rawParams);
  const t = await getTranslations({ locale, namespace: "products" });

  const { robots, canonicalPath } = discoverMetadataFor({ query, category });
  const { canonical, languages } = buildAlternates(
    canonicalPath,
    locale as "zh-TW" | "en",
  );

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
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

  // Parallel fetch: products + facet counts
  let products: CatalogProduct[] = [];
  let totalCount = 0;
  let searchSource: string | undefined;
  let degraded = false;
  let facets: {
    subcategoryCounts: { slug: string; count: number }[];
    materialCounts: { slug: string; count: number }[];
  } = {
    subcategoryCounts: [],
    materialCounts: [],
  };
  try {
    if (isSearchMode) {
      const [searchResult, facetResult] = await Promise.all([
        searchProductsBySituation({
          query: searchQuery,
          locale: locale as "zh-TW" | "en",
          sort,
          category,
          subcategories: subcategories.length > 0 ? subcategories : undefined,
          materials: materials.length > 0 ? materials : undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
        getProductFacetCounts(category),
      ]);
      products = searchResult.products;
      totalCount = searchResult.totalCount;
      searchSource = searchResult.searchSource;
      degraded = searchResult.degraded;
      facets = facetResult;
    } else {
      // In catalog mode, sort is never "relevance" (parseDiscoverQuery guarantees this)
      const catalogSort = sort as "newest" | "alphabetical";
      const [productResult, facetResult] = await Promise.all([
        getPublishedCuratedProducts({
          category,
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
    captureReadFailure("discover.catalog")(err);
  }

  // Build subcategory options for sidebar (only for active category, filter count > 0)
  const subcategoryOptions = category
    ? facets.subcategoryCounts
        .filter((fc) => {
          const node = subcategoryBySlug(fc.slug);
          return node && node.category === category;
        })
        .map((fc) => {
          const node = subcategoryBySlug(fc.slug)!;
          return {
            slug: fc.slug,
            label: subcategoryLabel(node, locale),
            count: fc.count,
          };
        })
    : [];

  // Build material options (filter count > 0)
  const materialOptions = facets.materialCounts
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
    });

  // Build active filters for chips
  const activeFilters: {
    type: "subcategory" | "material";
    slug: string;
    label: string;
  }[] = [
    ...subcategories.map((slug) => {
      const node = subcategoryBySlug(slug);
      return {
        type: "subcategory" as const,
        slug,
        label: node ? subcategoryLabel(node, locale) : slug,
      };
    }),
    ...materials.map((slug) => {
      const mat = MATERIALS.find((m) => m.slug === slug);
      return {
        type: "material" as const,
        slug,
        label: mat
          ? locale === "zh-TW"
            ? mat.nameZh
            : mat.nameEn
          : slug,
      };
    }),
  ];

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        <header className="prose-measure space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body">{t("subheading")}</p>
        </header>

        {/* Situation search form */}
        <ProductSituationSearchForm
          locale={locale}
          query={searchQuery}
          category={category}
          subcategories={subcategories}
          materials={materials}
          labels={{
            label: t("search.label"),
            placeholder: t("search.placeholder"),
            submit: t("search.submit"),
          }}
        />

        {/* Search results heading */}
        {isSearchMode && (
          <div className="space-y-1">
            <h2 className="type-section">
              {t("search.resultsHeading", { query: searchQuery })}
            </h2>
            <p className="type-metadata text-ink-muted">
              {t("search.count", { count: totalCount })}
            </p>
          </div>
        )}

        {/* Mobile drawer trigger */}
        <div className="lg:hidden">
          <ProductFilterDrawer
            locale={locale}
            activeCategory={category}
            allLabel={commonT("all")}
            subcategoryOptions={subcategoryOptions}
            activeSubSlugs={subcategories}
            materialOptions={materialOptions}
            activeMaterials={materials}
            totalCount={totalCount}
          />
        </div>

        <SavedProductsProvider>
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Desktop sidebar */}
          <aside className="hidden shrink-0 lg:block lg:w-48">
            <ProductFilterSidebar
              locale={locale}
              activeCategory={category}
              allLabel={commonT("all")}
              subcategoryOptions={subcategoryOptions}
              activeSubSlugs={subcategories}
              materialOptions={materialOptions}
              activeMaterials={materials}
              totalCount={totalCount}
            />
          </aside>

          <div className="min-w-0 flex-1">
            {/* Toolbar: result count + sort */}
            {totalCount > 0 && (
              <div className="mb-4 flex items-center justify-between gap-4">
                {!isSearchMode && (
                  <p className="type-metadata text-ink-muted">
                    {t("resultCount", { count: totalCount })}
                  </p>
                )}
                {isSearchMode && <span />}
                <ProductSortSelect
                  currentSort={sort}
                  showRelevance={isSearchMode}
                />
              </div>
            )}

            {/* Active filter chips */}
            {(activeFilters.length > 0 || isSearchMode) && (
              <div className="mb-4">
                <ProductActiveFilters
                  activeFilters={activeFilters}
                  query={searchQuery}
                />
              </div>
            )}

            {isSearchMode && (
              <SearchResultsTracker
                trackerKind="product"
                query={searchQuery}
                resultCount={totalCount}
                searchSource={searchSource}
                degraded={degraded}
              />
            )}

            {products.length === 0 ? (
              <EmptyState
                icon={<PackageOpen />}
                title={isSearchMode ? t("search.empty") : t("emptyState")}
              />
            ) : (
              <>
                <ProductGrid products={products} locale={locale} />
                <Pagination
                  totalCount={totalCount}
                  currentPage={page}
                  pageSize={PAGE_SIZE}
                />
              </>
            )}
          </div>
        </div>
        </SavedProductsProvider>
      </div>
    </PageShell>
  );
}
