"use client";

import { useTranslations } from "next-intl";
import {
  FilterSidebar,
  FilterDrawer,
  type SubcategoryOption,
} from "@/components/filters";
import type { DirectoryClearKey } from "@/lib/directory-filter-url";
import { routes } from "@/lib/routes";
import {
  trackCategoryFilterApplied,
  trackSubcategoryFilterApplied,
} from "@/lib/analytics";

export type BrandFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  totalCount: number;
};

/**
 * The drawer's clear-all matches the toolbar's 清除全部 (`clearDirectoryFilters`
 * with `includeSearch`): search and category go too, on top of sub and material.
 */
const BRAND_CLEAR_ALL_EXTRA_KEYS: DirectoryClearKey[] = ["search", "category"];

function brandCategoryHref(slug: string | null): string {
  return slug ? routes.brands({ category: slug }) : routes.brands();
}

function useBrandFilterLabels() {
  const t = useTranslations("brands.filters");
  return {
    t,
    labels: {
      title: t("title"),
      category: t("category"),
      subcategory: t("subcategory"),
      material: "",
      showMore: (count: number) => t("showMore", { count }),
      showLess: t("showLess"),
    },
  };
}

export function BrandFilterSidebar(props: BrandFilterSidebarProps) {
  const { labels } = useBrandFilterLabels();

  return (
    <FilterSidebar
      {...props}
      categoryHref={brandCategoryHref}
      labels={labels}
      onCategorySelect={trackCategoryFilterApplied}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}

export function BrandFilterDrawer(props: BrandFilterSidebarProps) {
  const { t, labels } = useBrandFilterLabels();

  return (
    <FilterDrawer
      {...props}
      categoryHref={brandCategoryHref}
      labels={labels}
      clearAllExtraKeys={BRAND_CLEAR_ALL_EXTRA_KEYS}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onCategorySelect={trackCategoryFilterApplied}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}
