import type { Brand } from '@/lib/types'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export function getProductTypeLabel(
  slug: string,
  locale: 'zh-TW' | 'en' = 'zh-TW',
): string | undefined {
  const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === slug)
  return category ? (locale === 'zh-TW' ? category.nameZh : category.name) : undefined
}

/**
 * Derives a localized category label for a brand.
 *
 * Prefer the canonical product_type taxonomy tag (which carries a reliable
 * localized name_zh) over brand.category — a denormalized free-text column
 * whose values don't consistently match the taxonomy. Fall back to it only
 * when the brand has no product_type tag.
 */
export function getBrandCategoryLabel(brand: Brand): string {
  const productTypeTags = brand.tags.filter((tag) => tag.category === 'product_type')
  const primaryCategoryTag =
    productTypeTags.find(
      (tag) => tag.name === brand.category || tag.nameZh === brand.category,
    ) ?? productTypeTags[0]
  return primaryCategoryTag?.nameZh ?? primaryCategoryTag?.name ?? brand.category ?? ''
}
