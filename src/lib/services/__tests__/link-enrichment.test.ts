import { describe, expect, it } from 'vitest'
import {
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  buildTextEnrichPatch,
  extractLinksFromUrls,
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
    expect(patch.social_facebook).toBe('https://facebook.com/scraped')
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

describe('extractLinksFromUrls', () => {
  it('maps Instagram URL to social_instagram', () => {
    const result = extractLinksFromUrls(['https://www.instagram.com/mybrand/'])
    expect(result.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('maps Threads URL to social_threads', () => {
    const result = extractLinksFromUrls(['https://www.threads.net/@mybrand'])
    expect(result.social_threads).toBe('https://www.threads.net/@mybrand')
  })

  it('maps Facebook URL to social_facebook', () => {
    const result = extractLinksFromUrls(['https://www.facebook.com/mybrand'])
    expect(result.social_facebook).toBe('https://www.facebook.com/mybrand')
  })

  it('maps Pinkoi URL to purchase_pinkoi', () => {
    const result = extractLinksFromUrls(['https://www.pinkoi.com/store/mybrand'])
    expect(result.purchase_pinkoi).toBe('https://www.pinkoi.com/store/mybrand')
  })

  it('maps Shopee URL to purchase_shopee', () => {
    const result = extractLinksFromUrls(['https://shopee.tw/mybrand'])
    expect(result.purchase_shopee).toBe('https://shopee.tw/mybrand')
  })

  it('ignores unrecognized URLs', () => {
    const result = extractLinksFromUrls(['https://example.com/page'])
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('handles multiple URLs from different platforms', () => {
    const result = extractLinksFromUrls([
      'https://www.instagram.com/mybrand/',
      'https://www.pinkoi.com/store/mybrand',
      'https://example.com',
    ])
    expect(result.social_instagram).toBe('https://www.instagram.com/mybrand/')
    expect(result.purchase_pinkoi).toBe('https://www.pinkoi.com/store/mybrand')
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('rejects corporate account URLs', () => {
    const result = extractLinksFromUrls([
      'https://www.instagram.com/ilovepinkoi/',
      'https://www.facebook.com/shopee.tw',
    ])
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('buildLinkEnrichPatch — overwrite-with-validation', () => {
  const baseBrand = {
    social_instagram: null, social_threads: null, social_facebook: null,
    purchase_pinkoi: null, purchase_shopee: null, website_url: null,
  }

  it('fills empty fields', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand },
      { social_instagram: 'https://www.instagram.com/mybrand/' }
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('overwrites existing values with new scraped values', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/oldbrand/' },
      { social_instagram: 'https://www.instagram.com/newbrand/' }
    )
    expect(patch.social_instagram).toBe('https://www.instagram.com/newbrand/')
  })

  it('skips when new value equals existing (no unnecessary write)', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/mybrand/' },
      { social_instagram: 'https://www.instagram.com/mybrand/' }
    )
    expect(patch.social_instagram).toBeUndefined()
  })

  it('rejects scraped corporate account values', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand },
      { social_instagram: 'https://www.instagram.com/ilovepinkoi/' }
    )
    expect(patch.social_instagram).toBeUndefined()
  })

  it('clears existing corporate value even when no scraped replacement', () => {
    const patch = buildLinkEnrichPatch(
      { ...baseBrand, social_instagram: 'https://www.instagram.com/ilovepinkoi/' },
      {}
    )
    expect(patch.social_instagram).toBeNull()
  })
})

describe('buildTextEnrichPatch (unified)', () => {
  it('fills description when brand has none', () => {
    const patch = buildTextEnrichPatch(
      { description: null, brand_highlights: null },
      { description: 'A premium handcrafted leather goods brand from Taiwan' }
    )
    expect(patch.description).toBe('A premium handcrafted leather goods brand from Taiwan')
  })

  it('fills description when existing is too short (<20 chars)', () => {
    const patch = buildTextEnrichPatch(
      { description: 'Short desc', brand_highlights: null },
      { description: 'A premium handcrafted leather goods brand from Taiwan' }
    )
    expect(patch.description).toBe('A premium handcrafted leather goods brand from Taiwan')
  })

  it('does not overwrite valid existing description', () => {
    const patch = buildTextEnrichPatch(
      { description: 'An existing description that is longer than 20 characters', brand_highlights: null },
      { description: 'A different scraped description from the website' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('rejects scraped description shorter than 20 chars', () => {
    const patch = buildTextEnrichPatch(
      { description: null, brand_highlights: null },
      { description: 'Too short' }
    )
    expect(patch.description).toBeUndefined()
  })

  it('fills brand_highlights from scraped story', () => {
    const patch = buildTextEnrichPatch(
      { description: 'Existing desc over twenty chars long', brand_highlights: null },
      { description: null, story: 'Founded in 2015 by artisans in Tainan' }
    )
    expect(patch.brand_highlights).toBe('Founded in 2015 by artisans in Tainan')
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
