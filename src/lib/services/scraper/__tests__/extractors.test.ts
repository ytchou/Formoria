import { describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import { filterHeroImage, extractSocialLinks, extractPurchaseLinks, emptyResult } from '../parse/extractors'

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

describe('emptyResult', () => {
  it('returns a null-filled ScrapedBrandData with the source url and no brandHighlights', () => {
    const r = emptyResult('https://site.com')
    expect(r.brandName).toBeNull()
    expect('brandHighlights' in r).toBe(false)
    expect(r.story).toBeNull()
  })
})
