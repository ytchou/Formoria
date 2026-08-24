import {
  L1_CATEGORIES,
  isVisibleCategory,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";

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
  if (!isVisibleCategory(brand.categorySlug)) return "";
  return getCategoryLabel(brand.categorySlug, locale) ?? brand.categorySlug;
}

/**
 * The localized L2 chip labels for a brand, one per stored subcategory.
 *
 * `brands.subcategories` holds English slugs since DEV-1510, so every surface
 * that renders them has to resolve them or show Latin text inside zh-TW copy.
 * The single lookup lives here, next to the L1 equivalent, because four
 * surfaces render the same array — the detail header, the card, the dashboard
 * hero and the public FAQ floor — and four hand-rolled ternaries is how the
 * locale rule drifted the last time.
 *
 * `subcategoriesEn` is read positionally as the en fallback for values the
 * ontology does not know. It is derived index-for-index from `subcategories`,
 * and it is the only place a human or model translation of a novel tag
 * survives; dropping to the raw zh string there would undo DEV-1266.
 */
export function getBrandSubcategoryLabels(
  brand: {
    subcategories: readonly string[];
    subcategoriesEn?: readonly string[] | null;
  },
  locale: string,
): string[] {
  const isEnglish = locale.startsWith("en");
  return brand.subcategories.map((stored, index) => {
    const subcategory = subcategoryBySlug(stored);
    if (subcategory) return isEnglish ? subcategory.nameEn : subcategory.nameZh;
    if (!isEnglish) return stored;
    return brand.subcategoriesEn?.[index]?.trim() || stored;
  });
}
