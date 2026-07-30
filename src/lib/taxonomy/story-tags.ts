import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

/**
 * Editorial tags live alongside the product-type vocabulary on the same axis.
 * They describe what a story *is* rather than what it is *about* — an expo
 * report is `event`, and may also carry `crafts` for its subject matter.
 */
export const STORY_EDITORIAL_TAGS = ['event'] as const

/**
 * The full story tag vocabulary: every L1 product-type slug plus the editorial
 * tags. Derived from `PRODUCT_TYPE_CATEGORIES` rather than restated, so the
 * story axis can never drift from the brand taxonomy.
 */
export const STORY_TAGS: readonly string[] = [
  ...PRODUCT_TYPE_CATEGORIES.map(category => category.slug),
  ...STORY_EDITORIAL_TAGS,
]

export function isStoryTag(value: string): boolean {
  return STORY_TAGS.includes(value)
}
