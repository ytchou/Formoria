import { describe, expect, it } from 'vitest'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  hasLinkValue,
  LINK_FIELDS,
  linkColumnFor,
} from '../link-enrichment'

describe('hasLinkValue', () => {
  it('returns false for null', () => { expect(hasLinkValue(null)).toBe(false) })
  it('returns false for empty string', () => { expect(hasLinkValue('')).toBe(false) })
  it('returns true for a URL string', () => { expect(hasLinkValue('https://instagram.com/brand')).toBe(true) })
})

describe('linkColumnFor', () => {
  it.each([
    ['socialInstagram', 'social_instagram'],
    ['socialThreads', 'social_threads'],
    ['socialFacebook', 'social_facebook'],
    ['purchaseWebsite', 'purchase_website'],
    ['purchasePinkoi', 'purchase_pinkoi'],
    ['purchaseShopee', 'purchase_shopee'],
  ] as const)('maps %s to %s', (field, column) => {
    expect(linkColumnFor(field)).toBe(column)
  })
})

describe('LINK_FIELDS', () => {
  it('contains exactly 6 fields', () => { expect(LINK_FIELDS).toHaveLength(6) })
})

describe('buildLinkEnrichPatch', () => {
  it('fills empty link fields from scraped data', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: 'https://facebook.com/existing',
      purchase_website: null, purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/brand', socialThreads: null,
      socialFacebook: 'https://facebook.com/scraped',
      purchaseWebsite: 'https://brand.com', purchasePinkoi: null,
      purchaseShopee: 'https://shopee.tw/brand',
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/brand')
    expect(patch.social_facebook).toBeUndefined()
    expect(patch.purchase_website).toBe('https://brand.com')
    expect(patch.purchase_shopee).toBe('https://shopee.tw/brand')
    expect(patch.social_threads).toBeUndefined()
    expect(patch.purchase_pinkoi).toBeUndefined()
  })

  it('returns empty patch when all fields match scraped data', () => {
    const brand = {
      social_instagram: 'https://instagram.com/x', social_threads: 'https://threads.net/x',
      social_facebook: 'https://facebook.com/x', purchase_website: 'https://x.com',
      purchase_pinkoi: 'https://pinkoi.com/x', purchase_shopee: 'https://shopee.tw/x',
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/x', socialThreads: 'https://threads.net/x',
      socialFacebook: 'https://facebook.com/x', purchaseWebsite: 'https://x.com',
      purchasePinkoi: 'https://pinkoi.com/x', purchaseShopee: 'https://shopee.tw/x',
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('updates existing fields when scraped data differs', () => {
    const brand = {
      social_instagram: 'https://instagram.com/old', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/new', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/new')
  })

  it('replaces corporate account with scraped value', () => {
    const brand = {
      social_instagram: 'https://instagram.com/ilovepinkoi', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/realbrand', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBe('https://instagram.com/realbrand')
  })

  it('nullifies corporate account when no replacement available', () => {
    const brand = {
      social_instagram: 'https://instagram.com/ilovepinkoi', social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: null, socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBeNull()
  })

  it('skips scraped values that are corporate accounts', () => {
    const brand = {
      social_instagram: null, social_threads: null,
      social_facebook: null, purchase_website: null,
      purchase_pinkoi: null, purchase_shopee: null,
    }
    const scraped = {
      socialInstagram: 'https://instagram.com/ilovepinkoi', socialThreads: null,
      socialFacebook: null, purchaseWebsite: null,
      purchasePinkoi: null, purchaseShopee: null,
    }
    const patch = buildLinkEnrichPatch(brand, scraped)
    expect(patch.social_instagram).toBeUndefined()
  })
})

describe('buildImageEnrichPatch', () => {
  it('promotes first stored image to hero when brand has none', () => {
    const brand = { heroImageUrl: null, productPhotos: [] }
    const storedUrls = ['https://storage.supabase.co/img1.jpg', 'https://storage.supabase.co/img2.jpg', null]
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(patch.heroImageUrl).toBe('https://storage.supabase.co/img1.jpg')
    expect(patch.productPhotos).toContain('https://storage.supabase.co/img2.jpg')
  })

  it('overwrites hero when brand already has one', () => {
    const brand = { heroImageUrl: 'https://existing-hero.jpg', productPhotos: [] }
    const storedUrls = ['https://storage.supabase.co/img1.jpg']
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(patch.heroImageUrl).toBe('https://storage.supabase.co/img1.jpg')
  })

  it('returns empty patch when no stored images', () => {
    const brand = { heroImageUrl: null, productPhotos: [] }
    const storedUrls = [null, null]
    const patch = buildImageEnrichPatch(brand, storedUrls)
    expect(Object.keys(patch)).toHaveLength(0)
  })
})
