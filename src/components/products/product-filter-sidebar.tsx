"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FilterSidebar,
  FilterDrawer,
  type SubcategoryOption,
} from "@/components/filters";
import { discoverClearAllKeys } from "@/lib/products/discover-search-params";
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
  activeCategory: string | null;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
  /** Render no counts: in search mode they are catalog-wide, not the query's. */
  hideCounts?: boolean;
};

function useProductFilterLabels() {
  const t = useTranslations("products.filters");
  return {
    t,
    labels: {
      title: t("title"),
      subcategory: t("subcategory"),
      material: t("material"),
      showMore: (count: number) => t("showMore", { count }),
      showLess: t("showLess"),
    },
  };
}

export function ProductFilterSidebar(props: ProductFilterSidebarProps) {
  const { labels } = useProductFilterLabels();

  return (
    <FilterSidebar
      {...props}
      labels={labels}
      onSubcategoryToggle={trackProductSubcategoryFilterApplied}
      onMaterialToggle={trackProductMaterialFilterApplied}
    />
  );
}

export function ProductFilterDrawer(props: ProductFilterSidebarProps) {
  const { t, labels } = useProductFilterLabels();
  const searchParams = useSearchParams();

  return (
    <FilterDrawer
      {...props}
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
