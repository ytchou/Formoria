import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

function findProductTypeCategory(value: string) {
  return PRODUCT_TYPE_CATEGORIES.find(
    (item) =>
      item.slug === value || item.name === value || item.nameZh === value,
  );
}

/** Resolves a product-type slug or localized display value to its canonical slug. */
export function resolveProductTypeSlug(value: string): string | undefined {
  return findProductTypeCategory(value)?.slug;
}

export function getProductTypeLabel(
  value: string,
  locale: "zh-TW" | "en" = "zh-TW",
): string | undefined {
  const category = findProductTypeCategory(value);
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
  brand: { category: string | null },
  locale: "zh-TW" | "en" = "zh-TW",
): string {
  if (!brand.category) return "";
  return getProductTypeLabel(brand.category, locale) ?? brand.category;
}
