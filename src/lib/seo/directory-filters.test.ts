import { describe, expect, it } from 'vitest'

import {
  hasDeferredCategoryFilter,
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
