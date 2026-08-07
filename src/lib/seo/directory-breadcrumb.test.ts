import { describe, expect, it } from 'vitest'
import { buildDirectoryBreadcrumbItems } from '@/components/brands/directory-breadcrumb'

describe('directory breadcrumb items', () => {
  it('builds three breadcrumb items for an L2 target', () => {
    expect(buildDirectoryBreadcrumbItems({
      locale: 'zh-TW',
      directoryLabel: 'Brands',
      category: { slug: 'home', label: 'Home & Living' },
      subcategory: { slug: 'furniture', label: 'Furniture' },
    })).toEqual([
      { label: 'Brands', href: '/brands' },
      { label: 'Home & Living', href: '/categories/home' },
      { label: 'Furniture', current: true },
    ])
  })

  it('builds two breadcrumb items for an L1 target', () => {
    expect(buildDirectoryBreadcrumbItems({
      locale: 'zh-TW',
      directoryLabel: 'Brands',
      category: { slug: 'home', label: 'Home & Living' },
    })).toEqual([
      { label: 'Brands', href: '/brands' },
      { label: 'Home & Living', current: true },
    ])
  })

  it('builds no breadcrumb items on the bare directory', () => {
    expect(buildDirectoryBreadcrumbItems({
      locale: 'zh-TW',
      directoryLabel: 'Brands',
    })).toEqual([])
  })

  it('builds locale-prefixed hrefs on en', () => {
    const items = buildDirectoryBreadcrumbItems({
      locale: 'en',
      directoryLabel: 'Brands',
      category: { slug: 'home', label: 'Home & Living' },
      subcategory: { slug: 'furniture', label: 'Furniture' },
    })

    expect(items[1]?.href).toBe('/en/categories/home')
  })
})
