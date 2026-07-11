import { describe, it, expect } from 'vitest'
import { mergePurchaseLinks, mergeScrapedData } from '../merge'
import { emptyResult } from '../parse/extractors'

describe('mergePurchaseLinks', () => {
  it('keeps base values and fills gaps from next', () => {
    const base = { purchaseWebsite: 'https://a.com', purchasePinkoi: 'https://pinkoi.com/a', purchaseShopee: null }
    const next = { purchaseWebsite: 'https://b.com', purchasePinkoi: null, purchaseShopee: 'https://shopee.tw/b' }
    const result = mergePurchaseLinks(base, next)
    expect(result.purchaseWebsite).toBe('https://a.com')
    expect(result.purchasePinkoi).toBe('https://pinkoi.com/a')
    expect(result.purchaseShopee).toBe('https://shopee.tw/b')
  })

  it('fills all gaps from next', () => {
    const base = { purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null }
    const next = { purchaseWebsite: 'https://b.com', purchasePinkoi: 'https://pinkoi.com/b', purchaseShopee: null }
    const result = mergePurchaseLinks(base, next)
    expect(result.purchaseWebsite).toBe('https://b.com')
    expect(result.purchasePinkoi).toBe('https://pinkoi.com/b')
    expect(result.purchaseShopee).toBeNull()
  })

  it('returns all nulls when both are empty', () => {
    const empty = { purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null }
    const result = mergePurchaseLinks(empty, empty)
    expect(result).toEqual({ purchaseWebsite: null, purchasePinkoi: null, purchaseShopee: null })
  })
})

describe('mergeScrapedData', () => {
  it('lets official-site fields win and social fills gaps', () => {
    const official = { ...emptyResult('https://brand.com'), brandName: 'Brand', description: 'Official copy' }
    const social = { ...emptyResult('https://instagram.com/brand'), brandName: 'IG name', socialInstagram: 'https://instagram.com/brand' }
    const merged = mergeScrapedData([
      { type: 'social', data: social },
      { type: 'official-site', data: official },
    ])
    expect(merged.brandName).toBe('Brand')                 // official wins
    expect(merged.socialInstagram).toContain('instagram.com/brand') // social fills gap
  })
  it('dedupes and caps categoryHints at 5', () => {
    const a = { ...emptyResult('https://a.com'), categoryHints: ['x','x','a','b','c','d','e','f'] }
    const merged = mergeScrapedData([{ type: 'official-site', data: a }])
    expect(merged.categoryHints.length).toBeLessThanOrEqual(5)
  })
})

describe('mergeScrapedData with stockistPageText', () => {
  it('uses first-wins for stockistPageText', () => {
    const official = { ...emptyResult('https://brand.com'), stockistPageText: 'Official stockists' }
    const social = { ...emptyResult('https://instagram.com/brand'), stockistPageText: 'Social stockists' }
    const result = mergeScrapedData([
      { type: 'official-site', data: official },
      { type: 'social', data: social },
    ])
    expect(result.stockistPageText).toBe('Official stockists')
  })
})

describe('mergeScrapedData with jsonLdImageUrls', () => {
  it('concatenates and deduplicates jsonLdImageUrls across sources', () => {
    const official = { ...emptyResult('https://brand.com'), jsonLdImageUrls: ['https://a.com/1.jpg', 'https://a.com/2.jpg'] }
    const ecommerce = { ...emptyResult('https://shopee.tw/brand'), jsonLdImageUrls: ['https://a.com/2.jpg', 'https://b.com/3.jpg'] }
    const result = mergeScrapedData([
      { type: 'official-site', data: official },
      { type: 'e-commerce', data: ecommerce },
    ])
    expect(result.jsonLdImageUrls).toHaveLength(3)
    expect(result.jsonLdImageUrls).toContain('https://a.com/1.jpg')
    expect(result.jsonLdImageUrls).toContain('https://a.com/2.jpg')
    expect(result.jsonLdImageUrls).toContain('https://b.com/3.jpg')
  })
})

describe('mergeScrapedData with purchase fields', () => {
  it('merges purchase links from multiple sources with precedence', () => {
    const officialSite = {
      data: { ...emptyResult('https://brand.com'), purchaseShopee: 'https://shopee.tw/brand' },
      type: 'official-site' as const,
    }
    const social = {
      data: { ...emptyResult('https://instagram.com/brand'), purchasePinkoi: 'https://pinkoi.com/brand' },
      type: 'social' as const,
    }
    const result = mergeScrapedData([social, officialSite])
    expect(result.purchaseShopee).toBe('https://shopee.tw/brand')
    expect(result.purchasePinkoi).toBe('https://pinkoi.com/brand')
  })
})
