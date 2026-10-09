"use client";

import { useTranslations } from "next-intl";
import {
  FilterSidebar,
  FilterDrawer,
  type SubcategoryOption,
} from "@/components/filters";
import type { DirectoryClearKey } from "@/lib/directory-filter-url";
import { trackSubcategoryFilterApplied } from "@/lib/analytics";

export type BrandFilterSidebarProps = {
  activeCategory: string | null;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  totalCount: number;
  /** Render no counts while a search is active (see `FilterSidebarProps`). */
  hideCounts?: boolean;
};

/**
 * The drawer's clear-all matches the toolbar's 清除全部 (`clearDirectoryFilters`
 * with `includeSearch`): search and category go too, on top of sub and material.
 */
const BRAND_CLEAR_ALL_EXTRA_KEYS: DirectoryClearKey[] = ["search", "category"];

function useBrandFilterLabels() {
  const t = useTranslations("brands.filters");
  return {
    t,
    labels: {
      title: t("title"),
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
      labels={labels}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}

export function BrandFilterDrawer(props: BrandFilterSidebarProps) {
  const { t, labels } = useBrandFilterLabels();

  return (
    <FilterDrawer
      {...props}
      labels={labels}
      clearAllExtraKeys={BRAND_CLEAR_ALL_EXTRA_KEYS}
      triggerLabel={t("trigger")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onSubcategoryToggle={trackSubcategoryFilterApplied}
    />
  );
}
