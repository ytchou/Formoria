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
import { routes } from "@/lib/routes";
import {
  isVisibleCategory,
  subcategoryBySlug,
  subcategoryLabel,
  MATERIALS,
} from "@/lib/taxonomy/ontology";

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
  query: Record<string, string | string[] | undefined>,
): {
  category: string | null;
  subcategories: string[];
  materials: string[];
  sort: "newest" | "alphabetical";
} {
  const category = firstParam(query.category);

  // Invalid category → 404
  if (category && !isVisibleCategory(category)) {
    notFound();
  }

  // Parse multi-select subcategories, silently drop invalid ones
  const rawSubs = parseCommaParam(query.sub);
  const subcategories = category
    ? rawSubs.filter((slug) => {
        const node = subcategoryBySlug(slug);
        return node && node.category === category;
      })
    : [];

  // Parse materials, validate against closed vocabulary
  const validMaterialSlugs: ReadonlySet<string> = new Set(MATERIALS.map((m) => m.slug));
  const materials = parseCommaParam(query.material).filter((slug) =>
    validMaterialSlugs.has(slug),
  );

  // Parse sort
  const sortParam = firstParam(query.sort);
  const sort: "newest" | "alphabetical" =
    sortParam === "alphabetical" ? "alphabetical" : "newest";

  return { category, subcategories, materials, sort };
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const { category } = resolveDiscoverTaxonomy(query);
  const t = await getTranslations({ locale, namespace: "products" });
  const discoverPath = routes.discover({
    category: category || undefined,
  });
  const { canonical, languages } = buildAlternates(
    discoverPath,
    locale as "zh-TW" | "en",
  );

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
  };
}

export default async function DiscoverPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const { category, subcategories, materials, sort } =
    resolveDiscoverTaxonomy(query);
  const t = await getTranslations({ locale, namespace: "products" });
  const commonT = await getTranslations({ locale, namespace: "common" });
  const pageParam = firstParam(query.page);
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  // Parallel fetch: products + facet counts
  let products: CatalogProduct[] = [];
  let totalCount = 0;
  let facets: {
    subcategoryCounts: { slug: string; count: number }[];
    materialCounts: { slug: string; count: number }[];
  } = {
    subcategoryCounts: [],
    materialCounts: [],
  };
  try {
    const [productResult, facetResult] = await Promise.all([
      getPublishedCuratedProducts({
        category,
        subcategories: subcategories.length > 0 ? subcategories : undefined,
        materials: materials.length > 0 ? materials : undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      }),
      getProductFacetCounts(category),
    ]);
    products = productResult.products;
    totalCount = productResult.totalCount;
    facets = facetResult;
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
                <p className="type-metadata text-ink-muted">
                  {t("resultCount", { count: totalCount })}
                </p>
                <ProductSortSelect currentSort={sort} />
              </div>
            )}

            {/* Active filter chips */}
            {activeFilters.length > 0 && (
              <div className="mb-4">
                <ProductActiveFilters activeFilters={activeFilters} />
              </div>
            )}

            {products.length === 0 ? (
              <EmptyState icon={<PackageOpen />} title={t("emptyState")} />
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
