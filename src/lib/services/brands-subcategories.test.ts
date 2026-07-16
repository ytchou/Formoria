import { expect, it } from 'vitest'
import { describeWithDb } from '@/test/setup'
import { getBrands, getSubcategoryCounts } from './brands'

describeWithDb('getBrands subcategoryTags', () => {
  it('browse path: narrows a category to brands overlapping the tags', async () => {
    const all = await getBrands({ category: ['bags-accessories'], page: 1 })
    const filtered = await getBrands({
      category: ['bags-accessories'],
      subcategoryTags: ['口金包'],
      page: 1,
    })
    expect(filtered.totalCount).toBeGreaterThan(0)
    expect(filtered.totalCount).toBeLessThan(all.totalCount)
    for (const brand of filtered.brands) expect(brand.productTags).toContain('口金包')
  })

  it('search path: passes filter_tags through the RPC', async () => {
    const result = await getBrands({
      search: '包',
      category: ['bags-accessories'],
      subcategoryTags: ['口金包'],
      page: 1,
    })
    for (const brand of result.brands) expect(brand.productTags).toContain('口金包')
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

describeWithDb('getSubcategoryCounts', () => {
  it('returns per-nameZh counts for approved brands in the category, only >0 entries', async () => {
    const counts = await getSubcategoryCounts('bags-accessories')
    expect(counts.get('口金包')).toBeGreaterThan(0)
    for (const count of counts.values()) expect(count).toBeGreaterThan(0)
  })
})
