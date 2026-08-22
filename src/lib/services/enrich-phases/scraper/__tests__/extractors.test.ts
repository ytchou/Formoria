import { describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import {
  filterHeroImage,
  extractSocialLinks,
  extractPurchaseLinks,
  emptyResult,
  extractPinkoiProductImages,
  extractShopeeProductImages,
  extractAllJsonLd,
  extractJsonLdImages,
  upgradeEcommerceImageUrl,
  largestSrcsetUrl,
} from '../parse/extractors'

describe('filterHeroImage', () => {
  it('rejects a logo/icon hero and keeps a real product hero', () => {
    expect(filterHeroImage('https://cdn.site.com/assets/logo.png', 'https://site.com')).toBeNull()
    expect(filterHeroImage('/img/hero-product.jpg', 'https://site.com')).toBe('https://site.com/img/hero-product.jpg')
  })
})

describe('extractSocialLinks', () => {
  it('pulls instagram + facebook hrefs', () => {
    const $ = cheerio.load('<a href="https://instagram.com/brand">ig</a><a href="https://facebook.com/brand">fb</a>')
    const links = extractSocialLinks($)
    expect(links.socialInstagram).toContain('instagram.com/brand')
    expect(links.socialFacebook).toContain('facebook.com/brand')
  })

  // A live run stored an Instagram POST permalink as a brand's Instagram, which
  // would have linked every visitor to a single photo instead of the account.
  it.each([
    'https://www.instagram.com/p/DQeL94sEv9G/',
    'https://www.instagram.com/reel/DQeL94sEv9G/',
    'https://www.instagram.com/reels/DQeL94sEv9G/',
    'https://www.instagram.com/stories/brand/123/',
    'https://www.instagram.com/explore/tags/tea/',
    'https://www.instagram.com/',
  ])('rejects the non-profile Instagram URL %s', (href) => {
    const $ = cheerio.load(`<a href="${href}">ig</a>`)
    expect(extractSocialLinks($).socialInstagram).toBeNull()
  })

  it('still accepts a real Instagram profile alongside a post link', () => {
    const $ = cheerio.load(
      '<a href="https://www.instagram.com/p/DQeL94sEv9G/">post</a>' +
        '<a href="https://www.instagram.com/chatzutang/">profile</a>'
    )
    expect(extractSocialLinks($).socialInstagram).toBe('https://www.instagram.com/chatzutang/')
  })

  // Meta migrated Threads to threads.com; the old threads.net-only test dropped
  // every profile on the new host.
  it('accepts a threads.com profile and a threads.net profile', () => {
    const dotCom = cheerio.load('<a href="https://www.threads.com/@brand">threads</a>')
    expect(extractSocialLinks(dotCom).socialThreads).toBe('https://www.threads.com/@brand')

    const dotNet = cheerio.load('<a href="https://www.threads.net/@brand">threads</a>')
    expect(extractSocialLinks(dotNet).socialThreads).toBe('https://www.threads.net/@brand')
  })

  it('rejects a Threads post URL and the bare Threads root', () => {
    const post = cheerio.load('<a href="https://www.threads.com/@brand/post/ABC123">post</a>')
    expect(extractSocialLinks(post).socialThreads).toBeNull()

    const root = cheerio.load('<a href="https://www.threads.com/">threads</a>')
    expect(extractSocialLinks(root).socialThreads).toBeNull()
  })

  it('still excludes Facebook system paths', () => {
    const $ = cheerio.load(
      '<a href="https://www.facebook.com/sharer/">share</a>' +
        '<a href="https://developers.facebook.com/docs">devs</a>'
    )
    expect(extractSocialLinks($).socialFacebook).toBeNull()
  })
})

describe('extractPurchaseLinks', () => {
  it('extracts both Pinkoi and Shopee links', () => {
    const $ = cheerio.load(
      '<a href="https://www.pinkoi.com/store/mybrand">Pinkoi</a><a href="https://shopee.tw/mybrand">Shopee</a>'
    )
    const links = extractPurchaseLinks($)
    expect(links.purchasePinkoi).toBe('https://www.pinkoi.com/store/mybrand')
    expect(links.purchaseShopee).toBe('https://shopee.tw/mybrand')
  })

  it('returns all nulls when no purchase links found', () => {
    const $ = cheerio.load('<a href="https://example.com">Example</a>')
    const links = extractPurchaseLinks($)
    expect(links.purchasePinkoi).toBeNull()
    expect(links.purchaseShopee).toBeNull()
    expect(links.purchaseWebsite).toBeNull()
  })

  // Regression guard: harvesting is host-level, not the registry's strict
  // `urlPattern`. Every URL below was harvested before the registry refactor
  // and must keep being harvested — `urlPattern` would reject all five.
  it.each([
    ['https://www.pinkoi.com/store/mybrand', 'purchasePinkoi'],
    ['https://pinkoi.com/product/abc', 'purchasePinkoi'],
    ['https://www.pinkoi.com/zh-TW/store/mybrand', 'purchasePinkoi'],
    ['https://shopee.tw/mybrand', 'purchaseShopee'],
    ['https://shopee.com.tw/mybrand', 'purchaseShopee'],
    ['https://shopee.tw/shop/12345', 'purchaseShopee'],
    ['https://shopee.tw/mybrand?smtt=1', 'purchaseShopee'],
    ['https://shopee.com.tw/shop/123', 'purchaseShopee'],
    ['https://myship.7-11.com.tw/general/detail/GM123', 'purchaseMyship'],
  ] as const)('harvests %s into %s, and nothing else', (href, field) => {
    const $ = cheerio.load(`<a href="${href}">Buy</a>`)
    const links = extractPurchaseLinks($)
    expect(links[field]).toBe(href)
    // One href must not populate a second column: a Pinkoi link is not also a
    // website, and a marketplace host is not a second marketplace.
    for (const [key, value] of Object.entries(links)) {
      if (key !== field) expect(value, `${key} from ${href}`).toBeNull()
    }
  })

  it('does not harvest a lookalike host', () => {
    const $ = cheerio.load('<a href="https://evil.example.com/shopee.tw/mybrand">Fake</a>')
    const links = extractPurchaseLinks($)
    expect(links.purchaseShopee).toBeNull()
    expect(links.purchasePinkoi).toBeNull()
  })

  it('takes first match when multiple Pinkoi links exist', () => {
    const $ = cheerio.load(
      '<a href="https://www.pinkoi.com/store/first">Pinkoi</a><a href="https://www.pinkoi.com/store/second">Pinkoi</a>'
    )
    const links = extractPurchaseLinks($)
    expect(links.purchasePinkoi).toBe('https://www.pinkoi.com/store/first')
  })
})

describe('extractPinkoiProductImages', () => {
  it('extracts product images from Pinkoi CDN URLs in shop page grid', () => {
    const html = `
      <html><body>
        <div class="product-list">
          <a href="/product/abc1">
            <img src="https://cdn01.pinkoi.com/product/abc1/1/800x0.jpg" />
          </a>
          <a href="/product/abc2">
            <img src="https://cdn01.pinkoi.com/product/abc2/1/800x0.jpg" />
          </a>
          <a href="/product/abc3">
            <img data-src="https://cdn01.pinkoi.com/product/abc3/1/800x0.jpg" src="data:image/gif;base64,placeholder" />
          </a>
        </div>
      </body></html>
    `
    const $ = cheerio.load(html)
    const images = extractPinkoiProductImages($)
    expect(images).toHaveLength(3)
    expect(images[0]).toBe('https://cdn01.pinkoi.com/product/abc1/1/800x0.jpg')
    expect(images[1]).toBe('https://cdn01.pinkoi.com/product/abc2/1/800x0.jpg')
    expect(images[2]).toBe('https://cdn01.pinkoi.com/product/abc3/1/800x0.jpg')
  })

  it('caps at MAX_GALLERY_IMAGES', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      `<img src="https://cdn01.pinkoi.com/product/p${i}/1/800x0.jpg" />`
    ).join('')
    const html = `<html><body>${items}</body></html>`
    const $ = cheerio.load(html)
    const images = extractPinkoiProductImages($)
    expect(images.length).toBeLessThanOrEqual(5)
  })

  it('filters out non-product Pinkoi CDN URLs (avatars, banners)', () => {
    const html = `
      <html><body>
        <img src="https://cdn01.pinkoi.com/product/abc/1/800x0.jpg" />
        <img src="https://cdn01.pinkoi.com/store/avatar/abc.jpg" />
        <img src="https://cdn01.pinkoi.com/store/banner/abc.jpg" />
      </body></html>
    `
    const $ = cheerio.load(html)
    const images = extractPinkoiProductImages($)
    expect(images).toHaveLength(1)
    expect(images[0]).toContain('/product/')
  })

  it('returns empty array when no Pinkoi CDN product images found', () => {
    const html = `<html><body><img src="https://example.com/photo.jpg" /></body></html>`
    const $ = cheerio.load(html)
    const images = extractPinkoiProductImages($)
    expect(images).toEqual([])
  })
})

describe('extractShopeeProductImages', () => {
  it('extracts product images from Shopee CDN URLs', () => {
    const html = `
      <html><body>
        <div class="shop-search-result-view">
          <img src="https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product1_tn" />
          <img src="https://down-tw.img.susercontent.com/file/tw-11134207-7rasm-product2_tn" />
        </div>
      </body></html>
    `
    const $ = cheerio.load(html)
    const images = extractShopeeProductImages($)
    expect(images).toHaveLength(2)
    expect(images[0]).toContain('susercontent.com')
  })

  it('filters out Shopee UI/icon images', () => {
    const html = `
      <html><body>
        <img src="https://down-tw.img.susercontent.com/file/tw-product1" />
        <img src="https://down-tw.img.susercontent.com/file/tw-shop-avatar" />
        <img src="https://deo.shopeemobile.com/shopee/modules-federation/live/0/shopee__item-card-standard-v2/icon.png" />
      </body></html>
    `
    const $ = cheerio.load(html)
    const images = extractShopeeProductImages($)
    expect(images).toHaveLength(1)
  })

  it('caps at MAX_GALLERY_IMAGES', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      `<img src="https://down-tw.img.susercontent.com/file/tw-product${i}" />`
    ).join('')
    const html = `<html><body>${items}</body></html>`
    const $ = cheerio.load(html)
    const images = extractShopeeProductImages($)
    expect(images.length).toBeLessThanOrEqual(5)
  })

  it('returns empty array when no Shopee CDN product images found', () => {
    const html = `<html><body><img src="https://example.com/photo.jpg" /></body></html>`
    const $ = cheerio.load(html)
    const images = extractShopeeProductImages($)
    expect(images).toEqual([])
  })
})

describe('emptyResult', () => {
  it('returns a null-filled ScrapedBrandData with the source url', () => {
    const r = emptyResult('https://site.com')
    expect(r.brandName).toBeNull()
    expect(r.story).toBeNull()
    expect(r.stockistPageText).toBeNull()
    expect(r.jsonLdImageUrls).toEqual([])
  })
})


describe('extractAllJsonLd', () => {
  it('parses multiple JSON-LD script tags', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Organization","name":"Brand"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Shampoo","image":"https://cdn.example.com/shampoo.jpg"}</script>
    </head></html>`
    const $ = cheerio.load(html)
    const results = extractAllJsonLd($)
    expect(results).toHaveLength(2)
    expect(results[0]['@type']).toBe('Organization')
    expect(results[1]['@type']).toBe('Product')
  })

  it('skips malformed JSON-LD tags', () => {
    const html = `<html><head>
      <script type="application/ld+json">{invalid json}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Valid"}</script>
    </head></html>`
    const $ = cheerio.load(html)
    const results = extractAllJsonLd($)
    expect(results).toHaveLength(1)
  })

  it('returns empty array when no JSON-LD tags', () => {
    const $ = cheerio.load('<html><head></head></html>')
    expect(extractAllJsonLd($)).toEqual([])
  })
})

describe('extractJsonLdImages', () => {
  // The `image` value arrives in three shapes and the node carrying it sits at
  // three depths; every combination has to yield the same URL.
  it.each([
    ['a Product image string', [{ '@type': 'Product', image: 'https://cdn.example.com/product.jpg' }], ['https://cdn.example.com/product.jpg']],
    ['a Product image array', [{ '@type': 'Product', image: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }], ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']],
    ['a Product ImageObject', [{ '@type': 'Product', image: { '@type': 'ImageObject', url: 'https://cdn.example.com/img.jpg' } }], ['https://cdn.example.com/img.jpg']],
    ['a Product nested in @graph', [{ '@graph': [{ '@type': 'Product', image: 'https://cdn.example.com/graph.jpg' }] }], ['https://cdn.example.com/graph.jpg']],
    [
      'Products nested in an ItemList',
      [{
        '@type': 'ItemList',
        itemListElement: [
          { '@type': 'ListItem', item: { '@type': 'Product', image: 'https://cdn.example.com/item1.jpg' } },
          { '@type': 'ListItem', item: { '@type': 'Product', image: 'https://cdn.example.com/item2.jpg' } },
        ],
      }],
      ['https://cdn.example.com/item1.jpg', 'https://cdn.example.com/item2.jpg'],
    ],
    ['an Organization image', [{ '@type': 'Organization', image: 'https://cdn.example.com/org.jpg' }], ['https://cdn.example.com/org.jpg']],
    // A relative src resolves against the page it was scraped from.
    ['a relative Product image', [{ '@type': 'Product', image: '/images/product.jpg' }], ['https://example.com/images/product.jpg']],
    // A thumbnail in JSON-LD is upgraded on the way out, same as an <img> src.
    ['a Shopify thumbnail, upgraded to full size', [{ '@type': 'Product', image: 'https://cdn.shopify.com/s/files/1/products/widget_300x300.jpg' }], ['https://cdn.shopify.com/s/files/1/products/widget.jpg']],
  ])('extracts %s', (_label, jsonLd, expected) => {
    expect(extractJsonLdImages(jsonLd, 'https://example.com')).toEqual(expected)
  })

  it.each([
    ['a data: URI', 'data:image/png;base64,abc'],
    ['a logo/icon path', 'https://cdn.example.com/logo/brand.png'],
  ])('drops %s', (_label, image) => {
    expect(extractJsonLdImages([{ '@type': 'Product', image }], 'https://example.com')).toEqual([])
  })

  it('deduplicates URLs', () => {
    const jsonLd = [
      { '@type': 'Product', image: 'https://cdn.example.com/same.jpg' },
      { '@type': 'Product', image: 'https://cdn.example.com/same.jpg' },
    ]
    const images = extractJsonLdImages(jsonLd, 'https://example.com')
    expect(images).toHaveLength(1)
  })

  it('caps at 10 images', () => {
    const products = Array.from({ length: 15 }, (_, i) => ({
      '@type': 'Product', image: `https://cdn.example.com/p${i}.jpg`,
    }))
    const images = extractJsonLdImages(products, 'https://example.com')
    expect(images).toHaveLength(10)
  })
})

describe('upgradeEcommerceImageUrl', () => {
  it.each([
    // Each platform encodes the thumbnail dimension differently; the upgrade
    // strips the token and leaves everything else alone.
    ['Shopify _NxN', 'https://cdn.shopify.com/s/files/1/products/photo_300x300.jpg', 'https://cdn.shopify.com/s/files/1/products/photo.jpg'],
    ['Shopify _Nx', 'https://cdn.shopify.com/s/files/1/products/photo_800x.jpg', 'https://cdn.shopify.com/s/files/1/products/photo.jpg'],
    ['Cyberbiz -NxN', 'https://cyfood.cyberbiz.co/uploads/image-300x300.jpg', 'https://cyfood.cyberbiz.co/uploads/image.jpg'],
    ['Shopline ?w=', 'https://img.shoplineapp.com/media/image/original.png?w=300', 'https://img.shoplineapp.com/media/image/original.png'],
    // The sibling query params survive — only the width is dropped.
    ['Shopline ?width= among other params', 'https://shoplineimg.com/media/file.jpg?width=400&quality=80', 'https://shoplineimg.com/media/file.jpg?quality=80'],
  ])('upgrades %s', (_label, input, expected) => {
    expect(upgradeEcommerceImageUrl(input)).toBe(expected)
  })

  // Separate table: these assert the URL comes back UNCHANGED, so reporting
  // them under 'upgrades %s' would name the opposite of what is checked.
  it.each([
    ['an unrecognised host', 'https://cdn.example.com/photo.jpg'],
    ['a known host with no dimension token', 'https://cdn.shopify.com/s/files/1/products/photo.jpg'],
  ])('leaves %s untouched', (_label, input) => {
    expect(upgradeEcommerceImageUrl(input)).toBe(input)
  })
})

describe('largestSrcsetUrl', () => {
  it('picks the widest variant, not the first', () => {
    expect(
      largestSrcsetUrl('https://cdn.site.com/s.jpg 320w, https://cdn.site.com/m.jpg 640w, https://cdn.site.com/l.jpg 1280w')
    ).toBe('https://cdn.site.com/l.jpg')
  })

  it('picks the widest variant regardless of declaration order', () => {
    expect(
      largestSrcsetUrl('https://cdn.site.com/l.jpg 1280w, https://cdn.site.com/s.jpg 320w')
    ).toBe('https://cdn.site.com/l.jpg')
  })

  it('returns an empty string for an empty srcset', () => {
    expect(largestSrcsetUrl('')).toBe('')
    expect(largestSrcsetUrl('   ')).toBe('')
  })

  it('returns the sole URL when no descriptor is present', () => {
    expect(largestSrcsetUrl('https://cdn.site.com/only.jpg')).toBe('https://cdn.site.com/only.jpg')
  })

  it('keeps document order among descriptor-less entries', () => {
    expect(largestSrcsetUrl('https://cdn.site.com/a.jpg, https://cdn.site.com/b.jpg')).toBe(
      'https://cdn.site.com/a.jpg'
    )
  })

  it('prefers a w-descriptor entry over an x-density entry', () => {
    expect(largestSrcsetUrl('https://cdn.site.com/a.jpg 2x, https://cdn.site.com/b.jpg 800w')).toBe(
      'https://cdn.site.com/b.jpg'
    )
  })

  it('skips malformed entries without dropping valid ones', () => {
    expect(largestSrcsetUrl(', , https://cdn.site.com/good.jpg 900w, ,')).toBe(
      'https://cdn.site.com/good.jpg'
    )
    expect(largestSrcsetUrl('https://cdn.site.com/x.jpg not-a-descriptor')).toBe(
      'https://cdn.site.com/x.jpg'
    )
  })
})
