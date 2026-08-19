import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  resolveDirectorySubcategorySlugs,
  resolveSubcategorySlugs,
  subcategoryBySlug,
} from '@/lib/taxonomy/ontology'
import { resolveCategoryRouteParams } from '@/app/[locale]/(site)/categories/category-params'
import { isDirectoryTargetMember } from '@/lib/seo/directory-sitemap'
import {
  directoryBrandCategoryFilter,
  summarizeSubcategoryRows,
  type SubcategorySummaryRow,
} from '../brands'

/**
 * DEV-1510 Task 11 — the cross-L1 read fix.
 *
 * 429 of 2,446 approved tag-uses (17%, over 266 brands) name a real ontology L2
 * whose parent L1 differs from the brand's own, and every read path dropped
 * them by conjoining the brand's `category` with the L2 filter. Nothing is
 * mis-tagged: the model forces exactly one L1 per brand, so a fashion label
 * that also sells backpacks has no other way to say so.
 *
 * `viza-viz` is the production witness (L1 `fashion`, carrying only bag tags);
 * the fixtures below are the same shape. The L2 slug already encodes its parent
 * — `subcategoryBySlug('backpacks').category === 'bags-accessories'` — which is
 * why the conjunct is redundant as well as destructive.
 *
 * The SQL predicates themselves (`.overlaps`, the RPC's `filter_subcategories`)
 * are covered by the integration suite. What is asserted here is every pure
 * decision that feeds them: which category filter a directory read may apply,
 * how the facet counts group, which brands a sitemap target claims, and — the
 * boundary — that the write-time normalizer and URL-pair validity are untouched.
 */

const CROSS_L1_BRAND: SubcategorySummaryRow = {
  category: 'fashion',
  subcategories: ['backpacks'],
  material: [],
  updatedAt: '2026-08-18T00:00:00.000Z',
}

const NATIVE_BRAND: SubcategorySummaryRow = {
  category: 'bags-accessories',
  subcategories: ['backpacks', 'tote-bags'],
  material: ['皮革'],
  updatedAt: '2026-08-17T00:00:00.000Z',
}

describe('cross-L1 reads', () => {
  it('l2_page_lists_a_cross_l1_brand', () => {
    // The L2 route resolves to (bags-accessories, backpacks) and hands both to
    // the directory. The brand-L1 conjunct must not survive that hand-off.
    expect(subcategoryBySlug('backpacks')?.category).toBe('bags-accessories')
    expect(
      directoryBrandCategoryFilter(['bags-accessories'], ['backpacks']),
    ).toBeUndefined()
    expect(resolveDirectorySubcategorySlugs(['backpacks']).map((sub) => sub.slug)).toEqual([
      'backpacks',
    ])

    // Membership in the L2 target is the L2 tag alone — the same rule the page
    // now selects on, and the reason the sitemap's lastmod tracks these rows.
    expect(
      isDirectoryTargetMember(
        { categorySlug: 'fashion', subcategories: ['backpacks'] },
        { categorySlug: 'bags-accessories', subcategorySlug: 'backpacks' },
      ),
    ).toBe(true)

    // The L1 target is unchanged: a fashion brand does not join /categories/bags-accessories.
    expect(
      isDirectoryTargetMember(
        { categorySlug: 'fashion', subcategories: ['backpacks'] },
        { categorySlug: 'bags-accessories' },
      ),
    ).toBe(false)
  })

  it('facet_counts_include_cross_l1_brands', () => {
    const summary = summarizeSubcategoryRows(
      [CROSS_L1_BRAND, NATIVE_BRAND],
      'bags-accessories',
    )

    // 2, not 1: the count groups by the L2's OWN parent instead of testing it
    // against the brand's. Before the fix the fashion row was discarded here.
    expect(summary.counts.get('backpacks')).toBe(2)
    expect(summary.counts.get('tote-bags')).toBe(1)

    // The fashion rail does not inherit a foreign L2 in exchange.
    expect(
      summarizeSubcategoryRows([CROSS_L1_BRAND, NATIVE_BRAND], 'fashion').counts.size,
    ).toBe(0)

    // `latestUpdatedAt` is scoped by the L2 too, so the cross-L1 row now dates
    // the page it actually appears on.
    expect(
      summarizeSubcategoryRows([CROSS_L1_BRAND, NATIVE_BRAND], 'bags-accessories', 'backpacks')
        .latestUpdatedAt,
    ).toBe(CROSS_L1_BRAND.updatedAt)
  })

  it('sub_filter_is_no_longer_a_silent_noop', () => {
    // The defect: `/brands?category=fashion&sub=backpacks` resolved to zero
    // subcategories, applied no tag filter at all, and returned EVERY fashion
    // brand while looking filtered. The scoped resolver still does that — which
    // is exactly why the directory stopped calling it.
    expect(resolveSubcategorySlugs('fashion', ['backpacks'])).toEqual([])

    const resolved = resolveDirectorySubcategorySlugs(['backpacks'])
    expect(resolved.map((sub) => sub.slug)).toEqual(['backpacks'])
    expect(directoryBrandCategoryFilter(['fashion'], ['backpacks'])).toBeUndefined()

    // Unknown slugs are dropped, not passed through as free text.
    expect(resolveDirectorySubcategorySlugs(['not-a-real-l2'])).toEqual([])
    // Without an L2 filter the L1 conjunct is the whole query and must survive.
    expect(directoryBrandCategoryFilter(['fashion'], [])).toEqual(['fashion'])
  })

  it('curated_products_still_drops_cross_l1', () => {
    // `resolveSubcategorySlugs` keeps its conjunct because curated products are
    // a WRITE-time normalizer with a separate contract: they hard-drop an L2
    // outside the product's own L1 on create and update.
    expect(resolveSubcategorySlugs('bags-accessories', ['backpacks']).map((sub) => sub.slug)).toEqual([
      'backpacks',
    ])
    expect(resolveSubcategorySlugs('fashion', ['backpacks'])).toEqual([])

    // And it is still the function curated-products calls, with a category.
    const source = readFileSync('src/lib/services/curated-products.ts', 'utf8')
    // The conjunct, not the argument name: DEV-1510 Task 15 rewrote the
    // normalizer around slug-native `normalizeSubcategories`, and pinning a
    // local variable name would fail on a refactor that keeps the contract.
    expect(source).toMatch(/resolveSubcategorySlugs\(\s*category,/)
    expect(source).not.toContain('resolveDirectorySubcategorySlugs')
  })

  it('url_pair_validity_is_unchanged', () => {
    // Loosening the read must NOT mint a second address for one L2. Only the
    // L2's own parent pairs with it; everything else 404s (a null resolution).
    expect(
      resolveCategoryRouteParams({ categorySlug: 'fashion', subcategorySlug: 'backpacks' }),
    ).toBeNull()
    expect(
      resolveCategoryRouteParams({
        categorySlug: 'bags-accessories',
        subcategorySlug: 'backpacks',
      })?.subcategory?.slug,
    ).toBe('backpacks')
    expect(
      resolveCategoryRouteParams({ categorySlug: 'fashion' })?.category.slug,
    ).toBe('fashion')
  })
})
