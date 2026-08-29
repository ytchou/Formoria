import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { captureReadFailure } from "@/lib/degraded-render";
import { ProductGrid } from "@/components/products/product-grid";
import { ProductFilterSidebar } from "@/components/products/product-filter-sidebar";
import { Pagination } from "@/components/brands/pagination";
import { buildAlternates } from "@/lib/seo/alternates";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";
import { routes } from "@/lib/routes";
import { isVisibleCategory, subcategoryBySlug } from "@/lib/taxonomy/ontology";

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
): { category: string | null; subcategory: string | null } {
  const category = firstParam(query.category);
  const subcategory = firstParam(query.sub);
  const subcategoryNode = subcategory ? subcategoryBySlug(subcategory) : null;

  if (
    (category && !isVisibleCategory(category)) ||
    (subcategory &&
      (!subcategoryNode ||
        !isVisibleCategory(subcategoryNode.category) ||
        (category && subcategoryNode.category !== category)))
  ) {
    notFound();
  }

  return { category, subcategory };
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const { category, subcategory } = resolveDiscoverTaxonomy(query);
  const t = await getTranslations({ locale, namespace: "products" });
  const discoverPath = routes.discover({
    category: category || undefined,
    sub: subcategory || undefined,
  });
  const { canonical, languages } = buildAlternates(discoverPath, locale as "zh-TW" | "en");

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical, languages },
  };
}

export default async function DiscoverPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const { category, subcategory } = resolveDiscoverTaxonomy(query);
  const t = await getTranslations({ locale, namespace: "products" });
  const commonT = await getTranslations({ locale, namespace: "common" });
  const pageParam = firstParam(query.page);
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;

  let products: Awaited<ReturnType<typeof getPublishedCuratedProducts>>["products"] = [];
  let totalCount = 0;
  try {
    const result = await getPublishedCuratedProducts({
      category,
      subcategory,
      page,
      pageSize: PAGE_SIZE,
    });
    products = result.products;
    totalCount = result.totalCount;
  } catch (err) {
    captureReadFailure("discover.catalog")(err);
  }

  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <div className="space-y-stack">
        <header className="prose-measure space-y-3">
          <h1 className="type-page-title">{t("heading")}</h1>
          <p className="type-body">{t("subheading")}</p>
        </header>

        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="shrink-0 lg:w-48">
            <ProductFilterSidebar
              locale={locale}
              activeCategory={category}
              allLabel={commonT("all")}
            />
          </aside>

          <div className="min-w-0 flex-1">
            {totalCount > 0 ? (
              <p className="mb-4 type-metadata text-ink-muted">
                {t("resultCount", { count: totalCount })}
              </p>
            ) : null}

            {products.length === 0 ? (
              <EmptyState
                icon={<PackageOpen />}
                title={t("emptyState")}
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
      </div>
    </PageShell>
  );
}
