import { describe, expect, it } from 'vitest'
import { resolveCategoryRouteParams } from '../category-params'

describe('category route params', () => {
  it('resolves a valid L1 slug', () => {
    expect(resolveCategoryRouteParams({ categorySlug: 'home' })?.category.slug).toBe('home')
  })

  it('resolves a valid L2 slug under its correct parent', () => {
    expect(resolveCategoryRouteParams({
      categorySlug: 'home',
      subcategorySlug: 'furniture',
    })?.subcategory?.slug).toBe('furniture')
  })

  it('rejects an L2 slug under the wrong parent', () => {
    expect(resolveCategoryRouteParams({
      categorySlug: 'fashion',
      subcategorySlug: 'furniture',
    })).toBeNull()
  })

  it('rejects an unknown slug at either level', () => {
    expect(resolveCategoryRouteParams({ categorySlug: 'unknown' })).toBeNull()
    expect(resolveCategoryRouteParams({ categorySlug: 'home', subcategorySlug: 'unknown' })).toBeNull()
  })
})
