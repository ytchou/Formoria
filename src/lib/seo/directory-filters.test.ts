import { describe, expect, it } from 'vitest'

import {
  hasDeferredCategoryFilter,
  hasInvalidCategoryFilter,
  parseDirectoryViewFilters,
} from './directory-filters'

describe('parseDirectoryViewFilters', () => {
  it('parses search and category filters', () => {
    const result = parseDirectoryViewFilters(
      { search: '椅子', category: 'home', sub: 'furniture' },
      new Set(['home']),
    )

    expect(result.filters.search).toBe('椅子')
    expect(result.filters.categorySlugs).toEqual(['home'])
    expect(result.filters.subcategorySlugs).toEqual(['furniture'])
  })
})

describe('hasDeferredCategoryFilter', () => {
  it('detects deferred slugs in scalar, comma-separated, and array params', () => {
    expect(hasDeferredCategoryFilter(undefined)).toBe(false)
    expect(hasDeferredCategoryFilter('home')).toBe(false)
    expect(hasDeferredCategoryFilter('home,food-drink')).toBe(true)
    expect(hasDeferredCategoryFilter(['home', 'tech'])).toBe(true)
  })
})

describe('hasInvalidCategoryFilter', () => {
  const valid = new Set(['home', 'fashion'])

  it('accepts an absent, empty, single, or all-valid multi-value category', () => {
    expect(hasInvalidCategoryFilter(undefined, valid)).toBe(false)
    expect(hasInvalidCategoryFilter('', valid)).toBe(false)
    expect(hasInvalidCategoryFilter('home', valid)).toBe(false)
    expect(hasInvalidCategoryFilter('home,fashion', valid)).toBe(false)
    expect(hasInvalidCategoryFilter(['home', 'fashion'], valid)).toBe(false)
  })

  it('flags any slug outside the valid set, scalar, comma-separated, or array', () => {
    expect(hasInvalidCategoryFilter('food', valid)).toBe(true)
    expect(hasInvalidCategoryFilter('home,food', valid)).toBe(true)
    expect(hasInvalidCategoryFilter(['home', 'tech'], valid)).toBe(true)
  })
})
