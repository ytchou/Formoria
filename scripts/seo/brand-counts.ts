/**
 * Reports approved-brand counts for the SEO keyword map.
 *
 * Usage: pnpm seo:counts
 */

import { createServiceClient } from '@/lib/supabase/server'
import {
  matchSubcategory,
  normalizeTagKey,
  PRODUCT_TYPE_CATEGORIES,
  subcategoryBySlug,
  type ProductSubcategory,
} from '@/lib/taxonomy/ontology'

export type BrandCountRow = {
  product_type: string | null
  product_tags: string[] | null
  status: string | null
  is_demo: boolean | null
}

type ProductTypeSlug = (typeof PRODUCT_TYPE_CATEGORIES)[number]['slug']

export type SubcategoryBrandCount = Pick<
  ProductSubcategory,
  'slug' | 'nameZh' | 'nameEn' | 'category'
> & {
  brand_count: number
  isComposite: boolean
}

type ThresholdKey = 'at_least_20' | 'at_least_15' | 'at_least_10' | 'at_least_5'

export type BrandCountResult = {
  product_type_totals: Record<ProductTypeSlug, number>
  subcategories: SubcategoryBrandCount[]
  thresholds: Record<ThresholdKey, number>
  unmatched: Array<{ tag: string; brand_count: number }>
}

function compareAscending(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareSubcategories(
  left: SubcategoryBrandCount,
  right: SubcategoryBrandCount,
): number {
  return right.brand_count - left.brand_count || compareAscending(left.slug, right.slug)
}

function toSubcategoryBrandCount(
  slug: string,
  brand_count: number,
): SubcategoryBrandCount | null {
  const subcategory = subcategoryBySlug(slug)
  if (!subcategory) return null

  return {
    slug: subcategory.slug,
    nameZh: subcategory.nameZh,
    nameEn: subcategory.nameEn,
    category: subcategory.category,
    brand_count,
    isComposite: subcategory.nameZh.includes('\u30fb'),
  }
}

export function aggregateBrandCounts(rows: BrandCountRow[]): BrandCountResult {
  const product_type_totals = {} as Record<ProductTypeSlug, number>
  for (const category of PRODUCT_TYPE_CATEGORIES) {
    product_type_totals[category.slug] = 0
  }

  const subcategoryCounts = new Map<string, number>()
  const unmatchedCounts = new Map<string, { tag: string; brand_count: number }>()

  for (const row of rows) {
    if (row.status !== 'approved' || row.is_demo === true) continue

    const productTypeCategory = PRODUCT_TYPE_CATEGORIES.find(
      ({ slug }) => slug === row.product_type,
    )
    if (productTypeCategory) {
      product_type_totals[productTypeCategory.slug] += 1
    }

    const seenSubcategorySlugs = new Set<string>()
    const seenUnmatchedTagKeys = new Set<string>()

    for (const tag of row.product_tags ?? []) {
      const matchedSubcategory = matchSubcategory(tag)
      if (matchedSubcategory) {
        const subcategory = subcategoryBySlug(matchedSubcategory.slug)
        if (!subcategory || seenSubcategorySlugs.has(subcategory.slug)) continue

        seenSubcategorySlugs.add(subcategory.slug)
        subcategoryCounts.set(
          subcategory.slug,
          (subcategoryCounts.get(subcategory.slug) ?? 0) + 1,
        )
        continue
      }

      const normalizedTagKey = normalizeTagKey(tag)
      if (!normalizedTagKey || seenUnmatchedTagKeys.has(normalizedTagKey)) continue

      seenUnmatchedTagKeys.add(normalizedTagKey)
      const current = unmatchedCounts.get(normalizedTagKey)
      if (current) {
        current.brand_count += 1
      } else {
        unmatchedCounts.set(normalizedTagKey, { tag, brand_count: 1 })
      }
    }
  }

  const subcategories = Array.from(subcategoryCounts.entries())
    .map(([slug, brand_count]) => toSubcategoryBrandCount(slug, brand_count))
    .filter((entry): entry is SubcategoryBrandCount => entry !== null)
    .sort(compareSubcategories)

  const thresholds: Record<ThresholdKey, number> = {
    at_least_20: subcategories.filter(({ brand_count }) => brand_count >= 20).length,
    at_least_15: subcategories.filter(({ brand_count }) => brand_count >= 15).length,
    at_least_10: subcategories.filter(({ brand_count }) => brand_count >= 10).length,
    at_least_5: subcategories.filter(({ brand_count }) => brand_count >= 5).length,
  }

  const unmatched = Array.from(unmatchedCounts.values()).sort(
    (left, right) =>
      right.brand_count - left.brand_count || compareAscending(left.tag, right.tag),
  )

  return { product_type_totals, subcategories, thresholds, unmatched }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { data, error } = await createServiceClient()
      .from('brands')
      .select('product_type, product_tags, status, is_demo')

    if (error) throw error

    const result = aggregateBrandCounts(data ?? [])
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
