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
  it('accepts valid HTTPS URL', () => {
    const result = scrapeUrlSchema.safeParse({ url: 'https://mybrand.com.tw' })
    expect(result.success).toBe(true)
  })

  it('accepts HTTPS URL with path', () => {
    const result = scrapeUrlSchema.safeParse({
      url: 'https://mybrand.com.tw/about',
    })
    expect(result.success).toBe(true)
  })

  it('rejects HTTP URL', () => {
    const result = scrapeUrlSchema.safeParse({ url: 'http://mybrand.com' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL', () => {
    const result = scrapeUrlSchema.safeParse({ url: 'not-a-url' })
    expect(result.success).toBe(false)
  })

  it('rejects empty string', () => {
    const result = scrapeUrlSchema.safeParse({ url: '' })
    expect(result.success).toBe(false)
  })

  it('rejects URL exceeding max length', () => {
    const result = scrapeUrlSchema.safeParse({
      url: 'https://x.com/' + 'a'.repeat(2048),
    })
    expect(result.success).toBe(false)
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

  it('accepts optional founder fields', () => {
    const result = brandInfoSchema.safeParse({
      name: 'Test Brand',
      category: 'food',
      description: 'A valid description here.',
      tags: [],
      logoUrl: 'https://example.com/logo.webp',
      founderName: 'Lin Wei-Chen',
      founderTitle: 'Founder & CEO',
      founderBio: 'Started the brand after returning from Tokyo.',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.founderName).toBe('Lin Wei-Chen')
      expect(result.data.founderBio).toBe(
        'Started the brand after returning from Tokyo.'
      )
    }
  })

  it('accepts missing founder fields (all optional)', () => {
    const result = brandInfoSchema.safeParse({
      name: 'Test Brand',
      category: 'food',
      description: 'A valid description here.',
      tags: [],
      logoUrl: 'https://example.com/logo.webp',
    })
    expect(result.success).toBe(true)
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
