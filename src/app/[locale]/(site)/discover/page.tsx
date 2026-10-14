import { DiscoverBrandRow } from "@/components/products/discover-brand-row";
import { DiscoverEmptyRoutes } from "@/components/products/discover-empty-routes";
import { DiscoverCategoryChips } from "@/components/products/discover-category-chips";
import { DiscoverTrailRail } from "@/components/products/discover-trail-rail";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
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
import { ProductActiveFilters } from "@/components/products/product-active-filters";
import { DiscoverUrlSync } from "@/components/products/discover-url-sync";
import { Pagination } from "@/components/brands/pagination";
import { ResultsHeading } from "@/components/brands/results-heading";
import { buildAlternates } from "@/lib/seo/alternates";
import { buildOpenGraph } from "@/lib/seo/open-graph";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import {
  isIntentParseRequested,
  loadDiscoverView,
} from "@/lib/services/discover-view";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import {
  VISIBLE_L1_CATEGORIES,
  categoryLabel,
  isVisibleCategory,
  subcategoryBySlug,
  MATERIALS,
} from "@/lib/taxonomy/ontology";
import {
  parseDiscoverQuery,
  discoverMetadataFor,
  buildDiscoverSyncQuery,
  hasInferParam,
  type DiscoverSort,
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

/** Whether the request carries a signed-in viewer. */
async function viewerIsAuthenticated(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
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
  const taxonomy = resolveDiscoverTaxonomy(rawParams);
  const t = await getTranslations({ locale, namespace: "products" });
  const commonT = await getTranslations({ locale, namespace: "common" });
  const landingT = await getTranslations({ locale, namespace: "landing" });

  // The viewer is read only when a paid intent parse was requested; the
  // service applies the login gate (DEV-1721/DEV-1964).
  const isAuthenticated = isIntentParseRequested(rawParams, taxonomy.query)
    ? await viewerIsAuthenticated()
    : false;
  const view = await loadDiscoverView({ rawParams, taxonomy, locale, isAuthenticated });
  if (view.outOfRange) {
    notFound();
  }

  const {
    searchQuery,
    sort,
    page,
    pageSize,
    products,
    totalCount,
    effectiveFilters: effective,
    subcategoryOptions,
    materialOptions,
    activeFilters,
    showSearchEmpty,
    showFilters,
    showTrailRail,
    hasChips,
    searchId,
  } = view;
  // Re-derived here (equal to view.isSearchMode) so TS narrows searchQuery.
  const isSearchMode = searchQuery !== null;

  const brandMatch =
    view.brandMatchCount > 0 && searchQuery
      ? {
          href: routes.brands({ search: searchQuery }),
          label: t("search.emptyRoutes.brandMatches", {
            count: view.brandMatchCount,
            query: searchQuery,
          }),
        }
      : null;

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
              effective,
              view.inferredFields,
            )}
          />
        )}

        <ResultsTransitionProvider>
        <DiscoverCategoryChips
          label={t("filters.category")}
          chips={categoryChips}
          activeCategory={effective.category}
        />

        {showTrailRail ? (
          <DiscoverTrailRail
            trails={view.railTrails}
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
                activeCategory={effective.category}
                hideCounts={isSearchMode}
                subcategoryOptions={subcategoryOptions}
                activeSubSlugs={effective.subcategories}
                materialOptions={materialOptions}
                activeMaterials={effective.materials}
                totalCount={totalCount}
              />
            </FilterAside>
          ) : null}

          <div className="min-w-0 flex-1">
            <DirectoryToolbar
              filterTrigger={
                showFilters ? (
                  <ProductFilterDrawer
                    activeCategory={effective.category}
                    hideCounts={isSearchMode}
                    subcategoryOptions={subcategoryOptions}
                    activeSubSlugs={effective.subcategories}
                    materialOptions={materialOptions}
                    activeMaterials={effective.materials}
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
              <SearchResultsTracker trackerKind="product" {...view.telemetry} />
            )}

            <PendingResults>
            <ResultsHeading>{t("resultsHeading", { count: totalCount })}</ResultsHeading>
            {isSearchMode && searchId && page === 1 && (
              <DiscoverBrandRow brands={view.relatedBrands} heading={t("brandRow.heading")} query={searchQuery} searchId={searchId} />
            )}

            {showSearchEmpty ? (
              // EmptyState takes a single action by contract, so the forward
              // routes render beside it, inside the same empty-state block.
              <div data-empty className="space-y-8">
                <EmptyState
                  icon={<PackageOpen />}
                  title={t("search.empty", { query: searchQuery! })}
                />
                <DiscoverEmptyRoutes
                  trails={view.emptyRouteTrails}
                  categories={view.emptyRouteCategories}
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
                    armBySlot={view.pageArmBySlot}
                    ltrMode={view.ltrMode}
                  >
                    <ProductGrid products={products} locale={locale} />
                  </DiscoverSearchClickTracker>
                ) : (
                  <ProductGrid products={products} locale={locale} />
                )}
                <Pagination
                  totalCount={totalCount}
                  currentPage={page}
                  pageSize={pageSize}
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
