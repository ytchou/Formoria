import { describe, it, expect } from 'vitest'
import {
  scrapeUrlSchema,
  brandInfoSchema,
  productsSchema,
  linksSchema,
  reviewSchema,
  fullSubmissionSchema,
} from './submission'

describe('scrapeUrlSchema', () => {
  it('accepts 1–3 https urls', () => {
    expect(scrapeUrlSchema.safeParse({ urls: ['https://a.com'] }).success).toBe(true)
    expect(scrapeUrlSchema.safeParse({ urls: ['https://a.com','https://b.com','https://c.com'] }).success).toBe(true)
  })
  it('dedupes identical urls', () => {
    const p = scrapeUrlSchema.safeParse({ urls: ['https://a.com','https://a.com'] })
    expect(p.success && p.data.urls.length).toBe(1)
  })
  it('rejects >3, empty, http, and non-urls', () => {
    expect(scrapeUrlSchema.safeParse({ urls: ['https://a.com','https://b.com','https://c.com','https://d.com'] }).success).toBe(false)
    expect(scrapeUrlSchema.safeParse({ urls: [] }).success).toBe(false)
    expect(scrapeUrlSchema.safeParse({ urls: ['http://a.com'] }).success).toBe(false)
    expect(scrapeUrlSchema.safeParse({ urls: ['nope'] }).success).toBe(false)
  })
})

describe('brandInfoSchema', () => {
  it('accepts valid brand info', () => {
    const result = brandInfoSchema.safeParse({
      name: '雨靴工作室',
      description:
        'Handcrafted rain boots from Tainan, combining traditional techniques with modern design.',
      category: 'fashion',
      tags: ['handmade', 'sustainable'],
      logoUrl: 'https://example.com/logo.webp',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = brandInfoSchema.safeParse({
      name: '',
      description: 'A valid description here.',
      category: 'fashion',
      tags: [],
      logoUrl: 'https://example.com/logo.webp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects description under 10 chars', () => {
    const result = brandInfoSchema.safeParse({
      name: 'TestBrand',
      description: 'Short',
      category: 'fashion',
      tags: [],
      logoUrl: 'https://example.com/logo.webp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing logo URL', () => {
    const result = brandInfoSchema.safeParse({
      name: 'TestBrand',
      description: 'A valid description here.',
      category: 'fashion',
      tags: [],
      logoUrl: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('brandInfoSchema — About description', () => {
  const base = {
    name: '測試品牌',
    description: '這是一個測試品牌的介紹文字。',
    category: 'tea',
    tags: [],
    logoUrl: 'https://example.com/logo.webp',
  }

  it('accepts an About description up to 2000 chars', () => {
    const result = brandInfoSchema.safeParse({
      ...base,
      description: '字'.repeat(2000),
    })
    expect(result.success).toBe(true)
  })

  it('rejects an About description over 2000 chars', () => {
    const result = brandInfoSchema.safeParse({
      ...base,
      description: '字'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

})

describe('productsSchema', () => {
  it('accepts empty products (all optional)', () => {
    const result = productsSchema.safeParse({
      productPhotos: [],
      brandHighlights: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid product photos and highlights', () => {
    const result = productsSchema.safeParse({
      productPhotos: [
        'https://example.com/photo1.webp',
        'https://example.com/photo2.webp',
      ],
      brandHighlights: 'Made with local Taiwanese cedar.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects more than 6 photos', () => {
    const result = productsSchema.safeParse({
      productPhotos: Array(7).fill('https://example.com/photo.webp'),
      brandHighlights: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects brandHighlights over 300 chars', () => {
    const result = productsSchema.safeParse({
      productPhotos: [],
      brandHighlights: 'a'.repeat(301),
    })
    expect(result.success).toBe(false)
  })
})

describe('linksSchema', () => {
  it('accepts valid purchase and social links', () => {
    const result = linksSchema.safeParse({
      purchaseLinks: [{ platform: 'shopee', url: 'https://shopee.tw/store' }],
      socialLinks: {
        instagram: '@mybrand',
        threads: '',
        facebook: '',
        website: 'https://mybrand.com',
      },
      retailLocations: [],
    })
    expect(result.success).toBe(true)
  })

  it('requires at least one purchase link', () => {
    const result = linksSchema.safeParse({
      purchaseLinks: [],
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      retailLocations: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL in purchase links', () => {
    const result = linksSchema.safeParse({
      purchaseLinks: [{ platform: 'shopee', url: 'not-a-url' }],
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      retailLocations: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('reviewSchema', () => {
  it('requires PDPA consent', () => {
    const result = reviewSchema.safeParse({ pdpaConsent: false })
    expect(result.success).toBe(false)
  })

  it('accepts when consent is given', () => {
    const result = reviewSchema.safeParse({ pdpaConsent: true })
    expect(result.success).toBe(true)
  })
})

describe('fullSubmissionSchema', () => {
  it('validates a complete submission', () => {
    const result = fullSubmissionSchema.safeParse({
      name: '雨靴工作室',
      description: 'Handcrafted rain boots from Tainan.',
      category: 'fashion',
      tags: ['handmade'],
      logoUrl: 'https://example.com/logo.webp',
      productPhotos: ['https://example.com/photo.webp'],
      brandHighlights: 'Cedar wood soles.',
      purchaseLinks: [{ platform: 'shopee', url: 'https://shopee.tw/store' }],
      socialLinks: {
        instagram: '@brand',
        threads: '',
        facebook: '',
        website: '',
      },
      retailLocations: [],
      pdpaConsent: true,
      turnstileToken: 'valid-token',
    })
    expect(result.success).toBe(true)
  })
})
