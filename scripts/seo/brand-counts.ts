/**
 * Reports approved-brand counts for the SEO keyword map.
 *
 * Usage: pnpm seo:counts
 */

import { pathToFileURL } from 'node:url'
import {
  excludeTestBrands,
  TEST_BRAND_NAME_PATTERN,
} from '@/lib/services/public-brand-filter'
import { createServiceClient } from '@/lib/supabase/service'
import {
  isCompositeSubcategory,
  matchSubcategory,
  normalizeTagKey,
  L1_CATEGORIES,
  subcategoryBySlug,
  type L2Subcategory,
} from '@/lib/taxonomy/ontology'

export type BrandCountRow = {
  name: string | null
  category: string | null
  subcategories: string[] | null
  status: string | null
}

/**
 * Mirrors `excludeTestBrands`' SQL `NOT LIKE` in memory so the pure aggregator
 * applies the exact same exclusion the public surfaces do. Derived from the
 * exported pattern rather than re-typing the literal: the filter drifting
 * between surfaces is precisely what this map must not reintroduce.
 */
const TEST_BRAND_NAME_REGEXP = new RegExp(
  `^${TEST_BRAND_NAME_PATTERN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('%', '.*')
    .replaceAll('_', '.')}$`,
)

export function isTestBrandName(name: string | null): boolean {
  return name !== null && TEST_BRAND_NAME_REGEXP.test(name)
}

type CategorySlug = (typeof L1_CATEGORIES)[number]['slug']

export type SubcategoryBrandCount = Pick<
  L2Subcategory,
  'slug' | 'nameZh' | 'nameEn' | 'category'
> & {
  brand_count: number
  corpus_brand_count: number
  l1_branches: number
  isComposite: boolean
}

type ThresholdKey = 'at_least_20' | 'at_least_15' | 'at_least_10' | 'at_least_5'

export type BrandCountResult = {
  category_totals: Record<CategorySlug, number>
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
  counts: {
    brand_count: number
    corpus_brand_count: number
    l1_branches: number
  },
): SubcategoryBrandCount | null {
  const subcategory = subcategoryBySlug(slug)
  if (!subcategory) return null

  return {
    slug: subcategory.slug,
    nameZh: subcategory.nameZh,
    nameEn: subcategory.nameEn,
    category: subcategory.category,
    ...counts,
    isComposite: isCompositeSubcategory(subcategory),
  }
}

export function aggregateBrandCounts(rows: BrandCountRow[]): BrandCountResult {
  const category_totals = {} as Record<CategorySlug, number>
  for (const category of L1_CATEGORIES) {
    category_totals[category.slug] = 0
  }

  const subcategoryCounts = new Map<string, number>()
  const corpusSubcategoryCounts = new Map<string, number>()
  const l1Branches = new Map<string, Set<CategorySlug>>()
  const unmatchedCounts = new Map<string, { tag: string; brand_count: number }>()

  for (const row of rows) {
    // Exclusion is deliberately identical to the public surfaces: approved
    // status + the test-brand name filter. `is_demo` is NOT excluded — no
    // public listing or count filters on it (see getSubcategoryCounts and
    // public-brand-filter.ts), so excluding it here would make this map report
    // fewer brands than the URL it is measuring.
    if (row.status !== 'approved' || isTestBrandName(row.name)) continue

    const categorySlugCategory = L1_CATEGORIES.find(
      ({ slug }) => slug === row.category,
    )
    if (categorySlugCategory) {
      category_totals[categorySlugCategory.slug] += 1
    }

    const seenSubcategorySlugs = new Set<string>()
    const seenCorpusSubcategorySlugs = new Set<string>()
    const seenUnmatchedTagKeys = new Set<string>()

    for (const tag of row.subcategories ?? []) {
      const matchedSubcategory = matchSubcategory(tag)
      if (matchedSubcategory) {
        const subcategory = subcategoryBySlug(matchedSubcategory.slug)
        if (!subcategory) continue

        // Corpus measurement is deliberately unscoped: it answers how many
        // approved brands carry a tag anywhere in the directory, even when the
        // brand's L1 differs from the subcategory's parent. Keep this tally
        // separate from the L1-scoped set below so the guard cannot suppress it.
        if (!seenCorpusSubcategorySlugs.has(subcategory.slug)) {
          seenCorpusSubcategorySlugs.add(subcategory.slug)
          corpusSubcategoryCounts.set(
            subcategory.slug,
            (corpusSubcategoryCounts.get(subcategory.slug) ?? 0) + 1,
          )

          if (categorySlugCategory) {
            const branches = l1Branches.get(subcategory.slug) ?? new Set<CategorySlug>()
            branches.add(categorySlugCategory.slug)
            l1Branches.set(subcategory.slug, branches)
          }
        }

        // Scope the tag to the brand's own L1: `/brands?category=jewelry`
        // filters on category, so a fashion brand tagged 手鍊 never appears
        // under the jewelry subcategory page. Counting it would inflate every
        // L2 count above what its URL actually renders (mirrors
        // getSubcategoryCounts' `subcategory?.category === categorySlug`).
        // A cross-category tag is not "unmatched" either — it resolves to a
        // real subcategory, just not one this brand's page belongs to.
        if (matchedSubcategory.category !== row.category) continue

        if (seenSubcategorySlugs.has(subcategory.slug)) continue

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

  const allSubcategorySlugs = new Set([
    ...corpusSubcategoryCounts.keys(),
    ...subcategoryCounts.keys(),
  ])
  const subcategories = Array.from(allSubcategorySlugs)
    .map((slug) =>
      toSubcategoryBrandCount(slug, {
        brand_count: subcategoryCounts.get(slug) ?? 0,
        corpus_brand_count: corpusSubcategoryCounts.get(slug) ?? 0,
        l1_branches: l1Branches.get(slug)?.size ?? 0,
      }),
    )
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

  return { category_totals, subcategories, thresholds, unmatched }
}

/** PostgREST caps an unbounded select at 1000 rows; page under that cap. */
const PAGE_SIZE = 1000

async function fetchAllBrandRows(): Promise<BrandCountRow[]> {
  const client = createServiceClient()
  const rows: BrandCountRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    // excludeTestBrands must wrap the FILTER builder (`.not` is gone once
    // `.order`/`.range` narrow it to a transform builder).
    const { data, error } = await excludeTestBrands(
      client.from('brands').select('name, category, subcategories, status'),
    )
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error

    const page = (data ?? []) as BrandCountRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

// `main()` is a named async function invoked from the entrypoint guard below
// rather than top-level await: `tsx` transpiles this file to CJS (the repo has
// no "type": "module"), and esbuild rejects top-level await under the cjs
// output format.
async function main(): Promise<void> {
  try {
    const result = aggregateBrandCounts(await fetchAllBrandRows())
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

// pathToFileURL, not a `file://` template: a repo path containing a space, `#`
// or non-ASCII character percent-encodes in import.meta.url, and the naive
// comparison would silently skip main() and exit 0 printing nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
