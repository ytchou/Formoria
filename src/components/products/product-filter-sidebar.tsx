"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FilterSidebar,
  FilterDrawer,
  type SubcategoryOption,
} from "@/components/filters";
import { routes } from "@/lib/routes";
import {
  discoverClearAllKeys,
  parseDiscoverQuery,
} from "@/lib/products/discover-search-params";
import {
  trackProductSubcategoryFilterApplied,
  trackProductMaterialFilterApplied,
} from "@/lib/analytics";

type MaterialOption = {
  value: string;
  label: string;
  count: number;
};

export type ProductFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  categoryCounts?: Record<string, number>;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
  /** Render no counts: in search mode they are catalog-wide, not the query's. */
  hideCounts?: boolean;
  /** Off on /discover, where the category chip row carries the categories. */
  showCategories?: boolean;
};

/**
 * Category links for the product filters. During a situation search they keep
 * `q`, so changing the category refines the search instead of ending it.
 */
function useProductCategoryHref() {
  const searchParams = useSearchParams();
  const { query } = parseDiscoverQuery({
    q: searchParams.get("q") ?? undefined,
  });
  return {
    searchParams,
    categoryHref: (slug: string | null) =>
      routes.discover({ category: slug ?? undefined, q: query }),
  };
}

function useProductFilterLabels() {
  const t = useTranslations("products.filters");
  return {
    t,
    labels: {
      title: t("title"),
      category: t("category"),
      subcategory: t("subcategory"),
      material: t("material"),
      showMore: (count: number) => t("showMore", { count }),
      showLess: t("showLess"),
    },
  };
}

export function ProductFilterSidebar(props: ProductFilterSidebarProps) {
  const { labels } = useProductFilterLabels();
  const { categoryHref } = useProductCategoryHref();

  return (
    <FilterSidebar
      {...props}
      categoryHref={categoryHref}
      labels={labels}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}

export function ProductFilterDrawer(props: ProductFilterSidebarProps) {
  const { t, labels } = useProductFilterLabels();
  const { searchParams, categoryHref } = useProductCategoryHref();

  return (
    <FilterDrawer
      {...props}
      categoryHref={categoryHref}
      labels={labels}
      clearAllExtraKeys={discoverClearAllKeys(searchParams)}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}
