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
      routerPath: '/brands?search=zzzznotabrandxyz&category=fashion',
      href: '/en/brands?search=zzzznotabrandxyz&category=fashion',
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
        slug: 'food-drink',
        locale: 'en',
      }),
    ).toEqual({
      routerPath: '/categories/food-drink',
      href: '/en/categories/food-drink',
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
      routerPath: '/categories/jewelry',
      href: '/en/categories/jewelry',
    })
  })

  it('targets a nested route for one subcategory', () => {
    expect(buildCategoryTabTarget({
      pathname: '/brands',
      searchParams: '',
      slug: 'home',
      subSlug: 'furniture',
      locale: 'zh-TW',
    })).toEqual({
      routerPath: '/categories/home/furniture',
      href: '/categories/home/furniture',
    })
  })

  it('keeps an active material facet instead of resolving to a bare taxonomy path', () => {
    // The material axis is orthogonal to the taxonomy, so a category or
    // subcategory click may not resolve to `/categories/...`: that path cannot
    // carry `?material=` and the filter would vanish with no trace.
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'category=fashion&material=%E6%9C%A8',
        slug: 'fashion',
        subSlug: 'dresses',
        locale: 'zh-TW',
      }).routerPath,
    ).toBe('/brands?category=fashion&material=%E6%9C%A8&sub=dresses')

    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: 'material=%E6%9C%A8',
        slug: 'fashion',
        locale: 'zh-TW',
      }).routerPath,
    ).toBe('/brands?material=%E6%9C%A8&category=fashion')
  })

  it('keeps a cross-L1 subcategory in the query rather than dropping it', () => {
    // `backpacks` belongs to `bags-accessories`, so `/categories/fashion/backpacks`
    // 404s — but the pair is a live filter since the brand query stopped
    // conjoining the L1, so it has to stay on `/brands`.
    expect(
      buildCategoryTabTarget({
        pathname: '/brands',
        searchParams: '',
        slug: 'fashion',
        subSlug: 'backpacks',
        locale: 'zh-TW',
      }).routerPath,
    ).toBe('/brands?category=fashion&sub=backpacks')
  })

  it('falls back to brands for multi-select taxonomy', () => {
    expect(buildCategoryTabTarget({
      pathname: '/brands',
      searchParams: 'search=chairs',
      slug: 'home',
      categorySlugs: ['fashion', 'home'],
      locale: 'zh-TW',
    }).routerPath).toBe('/brands?search=chairs&category=fashion%2Chome')
  })
})
