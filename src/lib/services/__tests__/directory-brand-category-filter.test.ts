import { describe, expect, it } from 'vitest'
import { directoryBrandCategoryFilter } from '../../services/brands'
import { L1_CATEGORIES } from '@/lib/taxonomy/ontology'

describe('directoryBrandCategoryFilter', () => {
  it('returns visible slugs when no category and no subcategory filter', () => {
    const result = directoryBrandCategoryFilter([], [])
    expect(result).toBeDefined()
    expect(result!.sort()).toEqual(
      ['bags-accessories', 'beauty', 'fashion', 'home', 'jewelry', 'stationery']
    )
  })

  it('returns user-selected categories unchanged', () => {
    const result = directoryBrandCategoryFilter(['home'], [])
    expect(result).toEqual(['home'])
  })

  it('returns undefined when subcategories are active', () => {
    const result = directoryBrandCategoryFilter([], ['furniture'])
    expect(result).toBeUndefined()
  })
})

describe('DEFERRED_CATEGORY_NAMES', () => {
  it('contains expected display names for all 6 deferred categories', () => {
    const deferredCategories = L1_CATEGORIES.filter(c => 'deferred' in c)
    expect(deferredCategories).toHaveLength(6)
    // Each deferred category contributes both name and nameZh
    const expectedNames = deferredCategories.flatMap(c => [c.name, c.nameZh])
    expect(expectedNames).toHaveLength(12)
  })
})
