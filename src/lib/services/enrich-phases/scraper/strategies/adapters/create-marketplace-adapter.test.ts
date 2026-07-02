import { describe, expect, it } from 'vitest'
import { pinkoiAdapter } from './pinkoi'
import { shopeeAdapter } from './shopee'

const pinkoiHtml = `
<html>
  <head>
    <meta property="og:title" content="手工皂 | Pinkoi 設計購物網站" />
    <meta property="og:description" content="Pinkoi brand story" />
    <meta property="og:image" content="https://cdn01.pinkoi.com/product/abc/1/800x0.jpg" />
    <meta name="keywords" content="soap, handmade" />
    <script type="application/ld+json">
      {"@type":"Organization","name":"手工皂 Pinkoi","description":"Story from JSON-LD","image":"https://cdn01.pinkoi.com/product/abc/1/800x0.jpg","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Store"}]}]}
    </script>
  </head>
  <body>
    <h1>手工皂 Pinkoi</h1>
    <a href="https://www.pinkoi.com/store/mybrand">Pinkoi</a>
    <a href="https://instagram.com/pinkoi.brand">Instagram</a>
    <img src="https://cdn01.pinkoi.com/product/abc/1/800x0.jpg" />
  </body>
</html>
`

const shopeeHtml = `
<html>
  <head>
    <meta property="og:title" content="茶葉禮盒 | Shopee Taiwan" />
    <meta property="og:description" content="Shopee brand story" />
    <meta property="og:image" content="https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn" />
    <meta name="keywords" content="tea, gifts" />
    <script type="application/ld+json">
      {"@type":"Store","name":"茶葉禮盒 Shopee","description":"Story from JSON-LD","image":"https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Shop"}]}]}
    </script>
  </head>
  <body>
    <h1>茶葉禮盒 Shopee</h1>
    <a href="https://shopee.tw/mybrand">Shopee</a>
    <a href="https://instagram.com/shopee.brand">Instagram</a>
    <img src="https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn" />
  </body>
</html>
`

const pinkoiDataTestIdFallbackHtml = `
<html>
  <head>
    <meta property="og:description" content="Pinkoi fallback story" />
  </head>
  <body>
    <div data-testid="store-name">
      <h1>粉紅設計 Pinkoi</h1>
    </div>
  </body>
</html>
`

const shopeeDataTestIdFallbackHtml = `
<html>
  <head>
    <meta property="og:description" content="Shopee fallback story" />
  </head>
  <body>
    <div data-testid="shop-header">
      <h1>蝦皮選物 Shopee</h1>
    </div>
  </body>
</html>
`

const pinkoiDescriptionOrderHtml = `
<html>
  <head>
    <meta property="og:title" content="手工皂 | Pinkoi 設計購物網站" />
  </head>
  <body>
    <h1>手工皂 Pinkoi</h1>
    <section class="product-description">Description wins</section>
    <section class="brand-story">Story loses</section>
  </body>
</html>
`

describe('createMarketplaceAdapter', () => {
  it('matches expected hosts', () => {
    expect(pinkoiAdapter.matches('https://sub.pinkoi.com/store/xiaoqi')).toBe(true)
    expect(shopeeAdapter.matches('https://shop.shopee.tw/shop/123')).toBe(true)
    expect(pinkoiAdapter.matches('https://example.com')).toBe(false)
  })

  it('parses pinkoi fixtures with the current output shape', () => {
    const result = pinkoiAdapter.parse(pinkoiHtml, 'https://pinkoi.com/store/mybrand')
    expect(result.brandName).toBe('手工皂')
    expect(result.description).toBe('Pinkoi brand story')
    expect(result.story).toBe('Pinkoi brand story')
    expect(result.heroImageUrl).toBe('https://cdn01.pinkoi.com/product/abc/1/800x0.jpg')
    expect(result.galleryImageUrls).toEqual(['https://cdn01.pinkoi.com/product/abc/1/800x0.jpg'])
    expect(result.purchasePinkoi).toBe('https://pinkoi.com/store/mybrand')
    expect(result.purchaseShopee).toBeNull()
    expect(result.socialInstagram).toBe('https://instagram.com/pinkoi.brand')
    expect(result.categoryHints).toEqual(['soap', 'handmade', 'Home', 'Store'])
    expect(result.rawJsonLd).toEqual({
      '@type': 'Organization',
      name: '手工皂 Pinkoi',
      description: 'Story from JSON-LD',
      image: 'https://cdn01.pinkoi.com/product/abc/1/800x0.jpg',
      '@graph': [{ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home' }, { name: 'Store' }] }],
    })
  })

  it('parses shopee fixtures with the current output shape', () => {
    const result = shopeeAdapter.parse(shopeeHtml, 'https://shopee.tw/shop/123')
    expect(result.brandName).toBe('茶葉禮盒')
    expect(result.description).toBe('Shopee brand story')
    expect(result.story).toBe('Shopee brand story')
    expect(result.heroImageUrl).toBe('https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn')
    expect(result.galleryImageUrls).toEqual(['https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn'])
    expect(result.purchaseShopee).toBe('https://shopee.tw/shop/123')
    expect(result.purchasePinkoi).toBeNull()
    expect(result.socialInstagram).toBe('https://instagram.com/shopee.brand')
    expect(result.categoryHints).toEqual(['tea', 'gifts', 'Home', 'Shop'])
    expect(result.rawJsonLd).toEqual({
      '@type': 'Store',
      name: '茶葉禮盒 Shopee',
      description: 'Story from JSON-LD',
      image: 'https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn',
      '@graph': [{ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home' }, { name: 'Shop' }] }],
    })
  })

  it('extracts brand names from adapter-specific data-testid fallbacks', () => {
    expect(pinkoiAdapter.parse(pinkoiDataTestIdFallbackHtml, 'https://pinkoi.com/store/mybrand').brandName).toBe('粉紅設計')
    expect(shopeeAdapter.parse(shopeeDataTestIdFallbackHtml, 'https://shopee.tw/shop/123').brandName).toBe('蝦皮選物')
  })

  it('prefers pinkoi description selector text over story text when both match', () => {
    const result = pinkoiAdapter.parse(pinkoiDescriptionOrderHtml, 'https://pinkoi.com/store/mybrand')
    expect(result.description).toBe('Description wins')
    expect(result.story).toBe('Description wins')
  })

  it('cleanly strips pinkoi and shopee title suffixes', () => {
    expect(pinkoiAdapter.parse(pinkoiHtml.replace('手工皂 | Pinkoi 設計購物網站', '手工皂 Pinkoi'), 'https://pinkoi.com/store/mybrand').brandName).toBe('手工皂')
    expect(shopeeAdapter.parse(shopeeHtml.replace('茶葉禮盒 | Shopee Taiwan', '茶葉禮盒 Shopee'), 'https://shopee.tw/shop/123').brandName).toBe('茶葉禮盒')
  })
})
