import { describe, it, expect } from 'vitest'
import { isStoreLocatorPath } from '../parse/page-kind'

// DEV-1943: a directly scraped URL is a store-locator page only when one whole
// path segment says so. The crawl link classifier matched substrings.
describe('isStoreLocatorPath', () => {
  it.each([
    'https://brand.com/stores',
    'https://brand.com/stores.html',
    'https://brand.com/pages/store-locator',
    'https://brand.com/where-to-buy',
    'https://brand.com/about/stores',
    'https://brand.com/shop/stores',
    'https://brand.com/pages/stockists',
    'https://brand.com/retailers/',
    'https://brand.com/pages/門市據點',
    'https://brand.com/pages/%E9%8A%B7%E5%94%AE%E9%80%9A%E8%B7%AF',
  ])('matches %s', (url) => {
    expect(isStoreLocatorPath(url)).toBe(true)
  })

  it.each([
    'https://brand.com/',
    'https://brand.com/store',
    'https://brand.com/storefront',
    'https://brand.com/restore-kit',
    'https://brand.com/blogs/news/store-opening',
    'https://brand.com/bookstore-collab',
    'https://brand.com/blogs/門市開幕',
    'https://brand.com/?page=stores',
    'not-a-url',
  ])('does not match %s', (url) => {
    expect(isStoreLocatorPath(url)).toBe(false)
  })
})
