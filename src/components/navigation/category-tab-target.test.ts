import { describe, expect, it } from 'vitest'
import { buildCategoryTabTarget } from './category-tab-target'

describe('category tab targets', () => {
  it('keeps category selection and removes stale pagination', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'category=old&page=3&sort=popular',
        slug: 'fashion',
        locale: 'en',
      }),
    ).toEqual({
      routerPath: '/brands?category=fashion&sort=popular',
      href: '/en/brands?category=fashion&sort=popular',
    })
  })

  it('removes the category and pagination for the all tab', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'category=fashion&page=2',
        slug: '',
        locale: 'zh-TW',
      }),
    ).toEqual({ routerPath: '/brands', href: '/brands' })
  })

  it('drops a failed search when switching category', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'search=zzzznotabrandxyz&category=old',
        slug: 'fashion',
        locale: 'en',
      }),
    ).toEqual({
      routerPath: '/brands?category=fashion',
      href: '/en/brands?category=fashion',
    })
  })

  it('drops every refinement for the all tab so it always escapes', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams:
          'category=fashion&price=1&verification=mit-verified&sub=bags',
        slug: '',
        locale: 'zh-TW',
      }),
    ).toEqual({ routerPath: '/brands', href: '/brands' })
  })

  it('drops a stale subcategory when switching category', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'category=fashion&sub=bags',
        slug: 'food',
        locale: 'en',
      }),
    ).toEqual({
      routerPath: '/brands?category=food',
      href: '/en/brands?category=food',
    })
  })

  it('targets the directory from another page', () => {
    expect(
      buildCategoryTabTarget({
        pathname: '/about',
        searchParams: '',
        slug: 'jewelry',
        locale: 'en',
      }),
    ).toEqual({
      routerPath: '/brands?category=jewelry',
      href: '/en/brands?category=jewelry',
    })
  })
})
