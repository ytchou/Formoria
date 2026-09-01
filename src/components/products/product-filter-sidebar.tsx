"use client";

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

function productCategoryHref(slug: string | null): string {
  return slug ? routes.discover({ category: slug }) : routes.discover();
}

export function ProductFilterSidebar(props: ProductFilterSidebarProps) {
  const t = useTranslations("products.filters");

  return (
    <FilterSidebar
      {...props}
      categoryHref={productCategoryHref}
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

  return (
    <FilterDrawer
      {...props}
      categoryHref={productCategoryHref}
      labels={{
        title: t("title"),
        subcategory: t("subcategory"),
        material: t("material"),
      }}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}
