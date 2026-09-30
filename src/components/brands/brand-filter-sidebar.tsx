"use client";

import { useTranslations } from "next-intl";
import { FilterSidebar, FilterDrawer } from "@/components/filters";
import { routes } from "@/lib/routes";
import {
  trackCategoryFilterApplied,
  trackSubcategoryFilterApplied,
} from "@/lib/analytics";

type SubcategoryOption = {
  slug: string;
  label: string;
  count: number;
  /** Parent L1; required for picking a 子分類 while no category is active. */
  category?: string;
};

export type BrandFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  totalCount: number;
};

function brandCategoryHref(slug: string | null): string {
  return slug ? routes.brands({ category: slug }) : routes.brands();
}

export function BrandFilterSidebar(props: BrandFilterSidebarProps) {
  const t = useTranslations("brands.filters");

  return (
    <FilterSidebar
      {...props}
      categoryHref={brandCategoryHref}
      labels={{
        title: t("title"),
        category: t("category"),
        subcategory: t("subcategory"),
        material: "",
        showMore: (count: number) => t("showMore", { count }),
        showLess: t("showLess"),
      }}
      onCategorySelect={trackCategoryFilterApplied}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}

export function BrandFilterDrawer(props: BrandFilterSidebarProps) {
  const t = useTranslations("brands.filters");

  return (
    <FilterDrawer
      {...props}
      categoryHref={brandCategoryHref}
      labels={{
        title: t("title"),
        category: t("category"),
        subcategory: t("subcategory"),
        material: "",
        showMore: (count: number) => t("showMore", { count }),
        showLess: t("showLess"),
      }}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onCategorySelect={trackCategoryFilterApplied}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}
