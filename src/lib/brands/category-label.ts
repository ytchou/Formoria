import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

function findL1Category(value: string) {
  return L1_CATEGORIES.find(
    (item) =>
      item.slug === value || item.name === value || item.nameZh === value,
  );
}

/** Resolves an L1 category slug or localized display value to its canonical slug. */
export function resolveCategorySlug(value: string): string | undefined {
  return findL1Category(value)?.slug;
}

export function getCategoryLabel(
  value: string,
  locale: "zh-TW" | "en" = "zh-TW",
): string | undefined {
  const category = findL1Category(value);
  return category
    ? locale === "zh-TW"
      ? category.nameZh
      : category.name
    : undefined;
}

/**
 * Derives a localized category label from the brand's slug or display-name category value.
 */
export function getBrandCategoryLabel(
  brand: { categorySlug?: string | null },
  locale: "zh-TW" | "en" = "zh-TW",
): string {
  if (!brand.categorySlug) return "";
  return getCategoryLabel(brand.categorySlug, locale) ?? brand.categorySlug;
}
