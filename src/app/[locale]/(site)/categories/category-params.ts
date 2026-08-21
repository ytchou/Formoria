import {
  L1_CATEGORIES,
  subcategoryBySlug,
  type L2Subcategory,
} from '@/lib/taxonomy/ontology'

export type CategoryRouteResolution = {
  category: (typeof L1_CATEGORIES)[number]
  subcategory: L2Subcategory | null
}
export function resolveCategoryRouteParams({
  categorySlug,
  subcategorySlug,
}: {
  categorySlug: string
  subcategorySlug?: string
}): CategoryRouteResolution | null {
  const category = L1_CATEGORIES.find((item) => item.slug === categorySlug)
  if (!category) return null

  if (!subcategorySlug) return { category, subcategory: null }

  const subcategory = subcategoryBySlug(subcategorySlug)
  if (!subcategory || subcategory.category !== category.slug) return null
  return { category, subcategory }
}
