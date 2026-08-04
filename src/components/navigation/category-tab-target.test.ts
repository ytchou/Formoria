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
