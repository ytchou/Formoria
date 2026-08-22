import { describe, expect, it } from 'vitest'

import {
  ROUTE_FAMILIES,
  classifyRoute,
  routeFamily,
  stripLocalePrefix,
} from '../route-family'

describe('route family', () => {
  it('normalizes locale variants to one family', () => {
    expect(routeFamily('/brands/mizu-tw')).toBe('directory:detail')
    expect(routeFamily('/zh-TW/brands/mizu-tw')).toBe('directory:detail')
    expect(routeFamily('/en/brands/mizu-tw')).toBe('directory:detail')

    // The resource is the same across locales too, or the same 700 slugs would
    // count as 2100 distinct resources.
    const ids = ['/brands/mizu-tw', '/zh-TW/brands/mizu-tw', '/en/brands/mizu-tw'].map(
      (pathname) => classifyRoute(pathname).resourceId,
    )
    expect(new Set(ids).size).toBe(1)
  })

  it('strips only known locale prefixes', () => {
    expect(stripLocalePrefix('/en/brands')).toBe('/brands')
    expect(stripLocalePrefix('/zh-TW')).toBe('/')
    expect(stripLocalePrefix('/enterprise/brands')).toBe('/enterprise/brands')
  })

  it('classifies all seven families', () => {
    expect(routeFamily('/brands')).toBe('directory:list')
    expect(routeFamily('/brands/mizu-tw')).toBe('directory:detail')
    expect(routeFamily('/brands', 'search=mizu')).toBe('directory:search')
    expect(routeFamily('/api/search', 'q=mizu')).toBe('directory:search')
    expect(routeFamily('/brands/NOT a slug')).toBe('directory:invalid-slug')
    expect(routeFamily('/sitemap.xml')).toBe('directory:sitemap')
    expect(routeFamily('/i/abcdef/cover.webp')).toBe('directory:image')
    expect(routeFamily('/about')).toBe('public:global-content')

    const observed = new Set([
      routeFamily('/brands'),
      routeFamily('/brands/mizu-tw'),
      routeFamily('/brands', 'search=mizu'),
      routeFamily('/brands/NOT a slug'),
      routeFamily('/sitemap.xml'),
      routeFamily('/i/abcdef/cover.webp'),
      routeFamily('/about'),
    ])
    expect(observed.size).toBe(7)
    expect(ROUTE_FAMILIES).toHaveLength(7)
    for (const family of observed) {
      expect(ROUTE_FAMILIES).toContain(family)
    }
  })

  it('image requests do not consume the detail budget', () => {
    expect(routeFamily('/i/abcdef/cover.webp')).toBe('directory:image')
    expect(routeFamily('/zh-TW/i/abcdef/cover.webp')).toBe('directory:image')
    expect(routeFamily('/i/abcdef/cover.webp')).not.toBe(
      routeFamily('/brands/mizu-tw'),
    )
  })

  it('treats a taxonomy browse path as a list, not a detail', () => {
    expect(routeFamily('/categories')).toBe('directory:list')
    expect(routeFamily('/categories/home-living')).toBe('directory:list')
    expect(routeFamily('/en/categories/home-living/lighting')).toBe(
      'directory:list',
    )
  })

  it('gives each brand slug its own resource id', () => {
    const first = classifyRoute('/brands/alpha-brand')
    const second = classifyRoute('/brands/beta-brand')

    expect(first.resourceId).not.toBe(second.resourceId)
  })
})
