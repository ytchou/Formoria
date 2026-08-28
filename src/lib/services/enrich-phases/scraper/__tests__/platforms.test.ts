import { describe, expect, it } from 'vitest'
import { identifyPlatform, isOwnedProductRoute } from '../platforms'

describe('platform registry', () => {
  it.each([
    [
      'https://store.example/products/a',
      '<script>Shopline.theme={}</script>',
      'shopline',
    ],
    [
      'https://store.example/SalePage/Index/1',
      '<meta name="generator" content="91APP">',
      '91app',
    ],
    [
      'https://store.example/products/a',
      '<script src="https://cyberbiz.co/app.js"></script>',
      'cyberbiz',
    ],
    ['https://pinkoi.com/store/example', '', 'pinkoi'],
    ['https://shopee.tw/example', '', 'shopee'],
    ['https://myship.7-11.com.tw/general/store/GM1', '', 'myship'],
    ['https://shop2000.com.tw/example', '', 'shop2000'],
    [
      'https://shop.example/products/a',
      '<img src="https://cdn.shopify.com/a.jpg">',
      'shopify',
    ],
    ['https://example.easy.co/products/a', '', 'easystore'],
    ['https://example.meepshop.com/products/a', '', 'meepshop'],
    ['https://example.waca.ec/product/detail/1', '', 'waca'],
    ['https://example.oen.tw/products/a', '', 'oen'],
  ] as const)('identifies %s as %s', (url, html, expected) => {
    expect(identifyPlatform(url, html)).toBe(expected)
  })

  it('binds a product route to the source host and platform route shape', () => {
    expect(
      isOwnedProductRoute(
        'https://shop.example/products/cup',
        'https://shop.example',
        'shopline',
      ),
    ).toBe(true)
    expect(
      isOwnedProductRoute(
        'https://other.example/products/cup',
        'https://shop.example',
        'shopline',
      ),
    ).toBe(false)
    expect(
      isOwnedProductRoute(
        'https://shop.example/collections/cups',
        'https://shop.example',
        'shopline',
      ),
    ).toBe(false)
  })

  describe('isOwnedProductRoute — expanded generic patterns', () => {
    it('accepts /shop/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/shop/blue-cup',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })

    it('accepts /store/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/store/item-1',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })

    it('accepts /catalog/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/catalog/widget',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })

    it('accepts /detail/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/detail/12345',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })

    it('accepts /product-page/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/product-page/blue-widget',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })

    it('rejects /collections/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/collections/summer',
          'https://example.com',
          null,
        ),
      ).toBe(false)
    })

    it('rejects /p/ path as generic product route', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/p/12345',
          'https://example.com',
          null,
        ),
      ).toBe(false)
    })

    it('rejects /about/ path', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/about/team',
          'https://example.com',
          null,
        ),
      ).toBe(false)
    })

    it('still accepts existing /product/ and /products/ paths', () => {
      expect(
        isOwnedProductRoute(
          'https://example.com/product/cup',
          'https://example.com',
          null,
        ),
      ).toBe(true)
      expect(
        isOwnedProductRoute(
          'https://example.com/products/cup',
          'https://example.com',
          null,
        ),
      ).toBe(true)
    })
  })
})
