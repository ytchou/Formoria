import type { Brand } from '@/lib/types'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export function getProductTypeLabel(
  value: string,
  locale: 'zh-TW' | 'en' = 'zh-TW',
): string | undefined {
  const category = PRODUCT_TYPE_CATEGORIES.find(
    (item) => item.slug === value || item.name === value || item.nameZh === value,
  )
  return category ? (locale === 'zh-TW' ? category.nameZh : category.name) : undefined
}

/**
 * Derives a localized category label from the brand's slug or display-name category value.
 */
export function getBrandCategoryLabel(brand: Brand, locale: 'zh-TW' | 'en' = 'zh-TW'): string {
  if (!brand.category) return ''
  return getProductTypeLabel(brand.category, locale) ?? brand.category
}
