import { describe, expect, it } from 'vitest'
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from './directory-filter-url'

describe('directory filter URLs', () => {
  it('updates one filter, preserves unrelated state, and resets pagination', () => {
    const params = new URLSearchParams(
      'search=herbs&category=jewelry&price=2&page=3&sort=name',
    )

    expect(updateDirectoryUrl('/brands', params, { search: null })).toBe(
      '/brands?category=jewelry&price=2&sort=name',
    )
  })

  it('clearing the category also clears dependent subcategories', () => {
    const params = new URLSearchParams(
      'search=herbs&category=jewelry&sub=earrings&sort=newest',
    )

    expect(updateDirectoryUrl('/brands', params, { category: null })).toBe(
      '/brands?search=herbs&sort=newest',
    )
  })

  it('clears non-search filters while preserving search and sort', () => {
    const params = new URLSearchParams(
      'search=herbs&category=jewelry&sub=earrings&price=2&verification=owned&page=2&sort=name',
    )

    expect(clearDirectoryFilters('/brands', params)).toBe(
      '/brands?search=herbs&sort=name',
    )
  })

  it('can include search when clearing filters', () => {
    const params = new URLSearchParams(
      'search=herbs&category=jewelry&sort=name',
    )

    expect(
      clearDirectoryFilters('/brands', params, { includeSearch: true }),
    ).toBe('/brands?sort=name')
  })
})
