import { describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import {
  filterHeroImage,
  extractSocialLinks,
  extractPurchaseLinks,
  emptyResult,
  extractPinkoiProductImages,
  extractShopeeProductImages,
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
})

describe('extractPurchaseLinks', () => {
  it('extracts Pinkoi link from href', () => {
    const $ = cheerio.load('<a href="https://www.pinkoi.com/store/mybrand">Pinkoi</a>')
    const links = extractPurchaseLinks($)
    expect(links.purchasePinkoi).toBe('https://www.pinkoi.com/store/mybrand')
    expect(links.purchaseShopee).toBeNull()
    expect(links.purchaseWebsite).toBeNull()
  })

  it('extracts Shopee link from href', () => {
    const $ = cheerio.load('<a href="https://shopee.tw/mybrand">Shopee</a>')
    const links = extractPurchaseLinks($)
    expect(links.purchaseShopee).toBe('https://shopee.tw/mybrand')
    expect(links.purchasePinkoi).toBeNull()
  })

  it('extracts Shopee com.tw link from href', () => {
    const $ = cheerio.load('<a href="https://shopee.com.tw/mybrand">Shopee</a>')
    const links = extractPurchaseLinks($)
    expect(links.purchaseShopee).toBe('https://shopee.com.tw/mybrand')
    expect(links.purchasePinkoi).toBeNull()
  })

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
  })
})
