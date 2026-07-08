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
 * Derives a localized category label for a brand using brands.category (product_type slug).
 */
export function getBrandCategoryLabel(brand: Brand, locale: 'zh-TW' | 'en' = 'zh-TW'): string {
  if (!brand.category) return ''
  const category = PRODUCT_TYPE_CATEGORIES.find((item) => item.slug === brand.category)
  return category ? (locale === 'zh-TW' ? category.nameZh : category.name) : brand.category
}
