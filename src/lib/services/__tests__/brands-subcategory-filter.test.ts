import { expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { directoryBrandCategoryFilter, getBrandSeoEntries, getBrands } from '../brands'

/**
 * The subcategory filter against real rows.
 *
 * Re-pinned for DEV-1510: `brands.subcategories` stores English slugs, so the
 * URL slug IS the stored value and there is no alias fan-out left to exercise.
 * The tag is `backpacks` rather than `clasp-frame-bags` because staging carries
 * 104 of the 795 production brands and nothing in that subset is tagged with
 * the latter — an assertion that can only ever read zero is not a test.
 */
const TAG = 'backpacks'
const PARENT_L1 = 'bags-accessories'

describeWithDb('getBrands subcategory slug filtering', () => {
  it('subcategory filter matches the stored slug', async () => {
    const result = await getBrands({
      category: [PARENT_L1],
      subcategoryTags: [TAG],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBeGreaterThan(0)
    for (const brand of result.brands) {
      expect(brand.subcategories).toContain(TAG)
    }
  })

  // The cross-L1 fix, end to end through the real SQL rather than through the
  // pure helpers. The filter arguments are built by the same function the
  // directory uses, so this fails if `directoryBrandCategoryFilter` ever starts
  // handing the brand's L1 back to the query: on staging `25togo` is the
  // witness — L1 `home`, tagged `backpacks` — and it disappears the moment the
  // conjunct returns.
  it('subcategory filter returns brands whose own L1 differs', async () => {
    const result = await getBrands({
      category: directoryBrandCategoryFilter([PARENT_L1], [TAG]),
      subcategoryTags: [TAG],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBeGreaterThan(0)
    expect(
      result.brands.some((brand) => brand.categorySlug !== PARENT_L1),
    ).toBe(true)
    for (const brand of result.brands) {
      expect(brand.subcategories).toContain(TAG)
    }
  })

  it('filtered totalCount equals the number of brands the same filter returns', async () => {
    const result = await getBrands({
      category: [PARENT_L1],
      subcategoryTags: [TAG],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBe(result.brands.length)
  })

  it('search plus subcategory filtering keeps totalCount and rows aligned', async () => {
    const result = await getBrands({
      search: '包',
      category: [PARENT_L1],
      subcategoryTags: [TAG],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBe(result.brands.length)
    for (const brand of result.brands) {
      expect(brand.subcategories).toContain(TAG)
    }
  })

  it('getBrandSeoEntries exposes subcategories', async () => {
    const entries = await getBrandSeoEntries()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((entry) => Array.isArray(entry.subcategories))).toBe(true)
  })

  // `getSubcategorySummary` is deliberately NOT covered here. It reads through
  // `unstable_cache`, which throws `Invariant: incrementalCache missing` outside
  // a Next work store — so the case that used to sit here could never pass under
  // vitest, and only looked green because integration runs are opt-in. Its
  // aggregation is asserted directly on rows in `cross-l1-reads.test.ts`
  // (`summarizeSubcategoryRows`), which is reachable and does not need a DB.
})
