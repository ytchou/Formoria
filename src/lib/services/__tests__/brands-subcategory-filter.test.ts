import { expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { getBrandSeoEntries, getBrands } from '../brands'

describeWithDb('getBrands subcategory alias filtering', () => {
  it('subcategory filter matches alias tags, not just the canonical name', async () => {
    const result = await getBrands({
      category: ['bags-accessories'],
      subcategoryTags: ['clasp-frame-bags'],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBeGreaterThan(0)
    expect(
      result.brands.some((brand) =>
        brand.productTags.some((tag) => ['口金包', '口金零錢包', '口金夾'].includes(tag)),
      ),
    ).toBe(true)
  })

  it('filtered totalCount equals the number of brands the same filter returns', async () => {
    const result = await getBrands({
      category: ['bags-accessories'],
      subcategoryTags: ['clasp-frame-bags'],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBe(result.brands.length)
  })

  it('search plus subcategory alias filtering keeps totalCount and rows aligned', async () => {
    const result = await getBrands({
      search: '包',
      category: ['bags-accessories'],
      subcategoryTags: ['clasp-frame-bags'],
      page: 1,
      limit: 100,
    })

    expect(result.totalCount).toBe(result.brands.length)
    for (const brand of result.brands) {
      expect(brand.productTags.some((tag) => ['口金包', '口金零錢包', '口金夾'].includes(tag))).toBe(true)
    }
  })

  it('getBrandSeoEntries exposes product_tags', async () => {
    const entries = await getBrandSeoEntries()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((entry) => Array.isArray(entry.productTags))).toBe(true)
  })
})
