import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { extractMyshipProductImages } from '../../parse/extractors'
import { myshipAdapter } from './myship'
import { pinkoiAdapter } from './pinkoi'
import { shopeeAdapter } from './shopee'
import { shoplineAdapter } from './shopline'

const pinkoiHtml = `
<html>
  <head>
    <meta property="og:title" content="手工皂 | Pinkoi 設計購物網站" />
    <meta property="og:description" content="Pinkoi brand story" />
    <meta property="og:image" content="https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg" />
    <meta name="keywords" content="soap, handmade" />
    <script type="application/ld+json">
      {"@type":"Organization","name":"手工皂 Pinkoi","description":"Story from JSON-LD","image":"https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg","@graph":[{"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Store"}]}]}
    </script>
  </head>
  <body>
    <h1>手工皂 Pinkoi</h1>
    <a href="https://www.pinkoi.com/store/mybrand">Pinkoi</a>
    <a href="https://instagram.com/pinkoi.brand">Instagram</a>
    <img src="https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg" />
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

// No og:title, no JSON-LD name, no <h1> — only the class-based storefront
// heading, which is the rung the registry refactor dropped.
const pinkoiClassNameFallbackHtml = `
<html>
  <body>
    <div class="store-name">品牌名</div>
  </body>
</html>
`

const shopeeClassNameFallbackHtml = `
<html>
  <body>
    <div class="shop-name">品牌名</div>
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

const myshipHtml = `
<html>
  <head>
    <meta property="og:title" content="茶日子小舖 | 7-ELEVEN 賣貨便" />
    <meta property="og:description" content="MyShip shop description" />
    <meta property="og:image" content="https://myship.7-11.com.tw/i/cgdm/GM123/hero.jpg" />
  </head>
  <body>
    <h1>茶日子小舖 | 7-ELEVEN 賣貨便</h1>
    <img src="https://myship.7-11.com.tw/i/cgdm/GM123/product.jpg" />
    <img src="https://myship.7-11.com.tw/assets/site-logo.png" />
  </body>
</html>
`

describe('createMarketplaceAdapter', () => {
  it('matches expected hosts', () => {
    expect(pinkoiAdapter.matches('https://sub.pinkoi.com/store/xiaoqi')).toBe(true)
    expect(shopeeAdapter.matches('https://shop.shopee.tw/shop/123')).toBe(true)
    expect(pinkoiAdapter.matches('https://example.com')).toBe(false)
  })

  it('myship adapter matches its host', () => {
    expect(
      myshipAdapter.matches('https://myship.7-11.com.tw/general/detail/GM123'),
    ).toBe(true)
  })

  it('parses pinkoi fixtures with the current output shape', () => {
    const result = pinkoiAdapter.parse(pinkoiHtml, 'https://pinkoi.com/store/mybrand')
    expect(result.brandName).toBe('手工皂')
    expect(result.description).toBe('Pinkoi brand story')
    expect(result.story).toBe('Pinkoi brand story')
    expect(result.heroImageUrl).toBe('https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg')
    expect(result.galleryImageUrls).toEqual(['https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg'])
    expect(result.purchasePinkoi).toBe('https://pinkoi.com/store/mybrand')
    expect(result.purchaseShopee).toBeNull()
    expect(result.socialInstagram).toBe('https://instagram.com/pinkoi.brand')
    expect(result.categoryHints).toEqual(['soap', 'handmade', 'Home', 'Store'])
    expect(result.rawJsonLd).toEqual({
      '@type': 'Organization',
      name: '手工皂 Pinkoi',
      description: 'Story from JSON-LD',
      image: 'https://cdn01.pinkoi.com/product/abc/1/1080x0.jpg',
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

  it('myship adapter extracts shop name from og:title', () => {
    expect(
      myshipAdapter.parse(myshipHtml, 'https://myship.7-11.com.tw/general/detail/GM123').brandName,
    ).toBe('茶日子小舖')
  })

  it('myship adapter extracts description and hero from og tags', () => {
    const result = myshipAdapter.parse(
      myshipHtml,
      'https://myship.7-11.com.tw/general/detail/GM123',
    )
    expect(result.description).toBe('MyShip shop description')
    expect(result.story).toBe('MyShip shop description')
    expect(result.heroImageUrl).toBe('https://myship.7-11.com.tw/i/cgdm/GM123/hero.jpg')
  })

  it('myship adapter sets purchaseMyship to the page URL', () => {
    const url = 'https://myship.7-11.com.tw/general/detail/GM123'
    expect(myshipAdapter.parse(myshipHtml, url).purchaseMyship).toBe(url)
  })

  it('extractMyshipProductImages keeps only /i/cgdm/ product paths', () => {
    const $ = cheerio.load(`
      <img src="https://myship.7-11.com.tw/i/cgdm/GM123/product.jpg" />
      <img src="https://myship.7-11.com.tw/i/cgdm/GM456/other.jpg" />
      <img src="https://myship.7-11.com.tw/assets/site-logo.png" />
    `)
    expect(extractMyshipProductImages($)).toEqual([
      'https://myship.7-11.com.tw/i/cgdm/GM123/product.jpg',
      'https://myship.7-11.com.tw/i/cgdm/GM456/other.jpg',
    ])
  })

  it('resolves relative MyShip product images from rendered storefront HTML', () => {
    const $ = cheerio.load(`
      <img src="/i/cgdm/GM2503154430218/2503150509956296.jpg" />
      <img src="/Images/shop/bx-facebook.png" />
    `)
    expect(
      extractMyshipProductImages(
        $,
        20,
        'https://myship.7-11.com.tw/general/detail/GM2503154430218',
      ),
    ).toEqual([
      'https://myship.7-11.com.tw/i/cgdm/GM2503154430218/2503150509956296.jpg',
    ])
  })

  it('extractMyshipProductImages rejects a foreign host with a product-shaped path', () => {
    const $ = cheerio.load(
      '<img src="https://ads.thirdparty.net/i/cgdm/GM99/banner.jpg" />',
    )
    expect(extractMyshipProductImages($)).toEqual([])
  })

  it('myship adapter matches only storefront detail pages', () => {
    expect(myshipAdapter.matches('https://myship.7-11.com.tw/general/detail/GM123')).toBe(true)
    expect(myshipAdapter.matches('https://myship.7-11.com.tw/')).toBe(false)
    expect(myshipAdapter.matches('https://myship.7-11.com.tw/general/help')).toBe(false)
  })

  it('extracts brand names from adapter-specific class-name fallbacks', () => {
    expect(
      pinkoiAdapter.parse(pinkoiClassNameFallbackHtml, 'https://pinkoi.com/store/mybrand')
        .brandName,
    ).toBe('品牌名')
    expect(
      shopeeAdapter.parse(shopeeClassNameFallbackHtml, 'https://shopee.tw/shop/123').brandName,
    ).toBe('品牌名')
  })

  it('applies upgradeEcommerceImageUrl to gallery image URLs', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Test Brand" />
        </head>
        <body>
          <div data-product-id="1">
            <img src="https://img.shoplineapp.com/media/image/product1.png?w=200" />
          </div>
          <div data-product-id="2">
            <img src="https://img.shoplineapp.com/media/image/product2.png?w=300&quality=80" />
          </div>
        </body>
      </html>
    `
    const result = shoplineAdapter.parse(html, 'https://store.shoplineapp.com/shop')
    // ?w= param should be stripped by upgradeEcommerceImageUrl
    expect(result.galleryImageUrls).not.toContainEqual(
      expect.stringContaining('?w=200'),
    )
    expect(result.galleryImageUrls).toContainEqual(
      'https://img.shoplineapp.com/media/image/product1.png',
    )
    // ?w=300 stripped but ?quality=80 kept
    expect(result.galleryImageUrls).toContainEqual(
      'https://img.shoplineapp.com/media/image/product2.png?quality=80',
    )
  })

  it('leaves non-matching CDN URLs unchanged in gallery', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Test Brand" />
        </head>
        <body>
          <div data-product-id="1">
            <img src="https://example.com/image.jpg" />
          </div>
        </body>
      </html>
    `
    const result = shoplineAdapter.parse(html, 'https://store.shoplineapp.com/shop')
    expect(result.galleryImageUrls).toContainEqual('https://example.com/image.jpg')
  })
})
