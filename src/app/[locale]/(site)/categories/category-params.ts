import {
  PRODUCT_TYPE_CATEGORIES,
  subcategoryBySlug,
  type ProductSubcategory,
} from '@/lib/taxonomy/ontology'

export type CategoryRouteResolution = {
  category: (typeof PRODUCT_TYPE_CATEGORIES)[number]
  subcategory: ProductSubcategory | null
}

export function resolveCategoryRouteParams({
  categorySlug,
  subcategorySlug,
}: {
  categorySlug: string
  subcategorySlug?: string
}): CategoryRouteResolution | null {
  const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === categorySlug)
  if (!category) return null

  if (!subcategorySlug) return { category, subcategory: null }

  const subcategory = subcategoryBySlug(subcategorySlug)
  if (!subcategory || subcategory.category !== category.slug) return null
  return { category, subcategory }
}

