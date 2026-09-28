"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilterSidebar, FilterDrawer } from "@/components/filters";
import { routes } from "@/lib/routes";
import {
  trackProductSubcategoryFilterApplied,
  trackProductMaterialFilterApplied,
} from "@/lib/analytics";

type SubcategoryOption = {
  slug: string;
  label: string;
  count: number;
};

type MaterialOption = {
  value: string;
  label: string;
  count: number;
};

export type ProductFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
};

/**
 * Category links for the product filters. During a situation search they keep
 * `q`, so changing the category refines the search instead of ending it.
 */
function useProductCategoryHref() {
  const q = useSearchParams().get("q");
  return {
    q,
    categoryHref: (slug: string | null) =>
      routes.discover({ category: slug ?? undefined, q }),
  };
}

export function ProductFilterSidebar(props: ProductFilterSidebarProps) {
  const t = useTranslations("products.filters");
  const { categoryHref } = useProductCategoryHref();

  return (
    <FilterSidebar
      {...props}
      categoryHref={categoryHref}
      labels={{
        title: t("title"),
        subcategory: t("subcategory"),
        material: t("material"),
      }}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}

export function ProductFilterDrawer(props: ProductFilterSidebarProps) {
  const t = useTranslations("products.filters");
  const { q, categoryHref } = useProductCategoryHref();

  return (
    <FilterDrawer
      {...props}
      categoryHref={categoryHref}
      labels={{
        title: t("title"),
        subcategory: t("subcategory"),
        material: t("material"),
      }}
      clearAllExtraKeys={q ? ["category", "inferred", "q"] : undefined}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}
