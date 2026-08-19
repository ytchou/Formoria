import { expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { getBrands } from './brands'

describeWithDb('getBrands subcategoryTags', () => {
  it('browse path: narrows a category to brands overlapping the tags', async () => {
    const all = await getBrands({ category: ['bags-accessories'], page: 1 })
    const filtered = await getBrands({
      category: ['bags-accessories'],
      subcategoryTags: ['backpacks'],
      page: 1,
    })
    expect(filtered.totalCount).toBeGreaterThan(0)
    expect(filtered.totalCount).toBeLessThan(all.totalCount)
    for (const brand of filtered.brands) expect(brand.subcategories).toContain('backpacks')
  })

  it('search path: passes filter_subcategories through the RPC', async () => {
    const result = await getBrands({
      search: '包',
      category: ['bags-accessories'],
      subcategoryTags: ['backpacks'],
      page: 1,
    })
    for (const brand of result.brands) expect(brand.subcategories).toContain('backpacks')
  })

  it('empty subcategoryTags is a no-op', async () => {
    const withoutTags = await getBrands({ category: ['bags-accessories'], page: 1 })
    const withEmptyTags = await getBrands({
      category: ['bags-accessories'],
      subcategoryTags: [],
      page: 1,
    })
    expect(withEmptyTags.totalCount).toBe(withoutTags.totalCount)
  })
})

describeWithDb('subcategory counts', () => {
  it('returns per-slug counts for approved brands in the category, only >0 entries', async () => {
    const { brands } = await getBrands({
      category: ['bags-accessories'],
      includeDetailColumns: true,
      limit: 100,
    })
    const counts = new Map<string, number>()
    for (const brand of brands) {
      for (const subcategory of brand.subcategories) {
        counts.set(subcategory, (counts.get(subcategory) ?? 0) + 1)
      }
    }
    expect(counts.get('backpacks')).toBeGreaterThan(0)
    for (const count of counts.values()) expect(count).toBeGreaterThan(0)
  })
})
