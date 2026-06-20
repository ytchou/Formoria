import { describe, it, expect } from 'vitest'
import type { Brand } from '@/lib/types'
import { scoreBrand, buildEnrichPatch, matchCategory } from '../curate-brands'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'test-id',
    name: 'Test Brand',
    slug: 'test-brand',
    description: null,
    heroImageUrl: null,
    status: 'pending',
    isVerified: false,
    isDemo: false,
    category: null,
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    brandHighlights: null,
    siteContent: null,
    tags: [],
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('scoreBrand', () => {
  it('returns 0 for empty brand with no URL (before penalty)', () => {
    const brand = makeBrand()
    const result = scoreBrand(brand)
    expect(result.score).toBeLessThan(0)
    expect(result.websiteUrl).toBeNull()
  })

  it('scores a fully populated brand at 90', () => {
    const brand = makeBrand({
      description:
        'A detailed description of this brand that is definitely long enough.',
      heroImageUrl: 'https://example.com/hero.jpg',
      productPhotos: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
      ],
      socialInstagram: 'https://instagram.com/test',
      purchaseWebsite: 'https://example.com',
      brandHighlights: 'Product A — Great',
      siteContent: null,
      category: 'Accessories',
    })
    const result = scoreBrand(brand)
    expect(result.score).toBe(90)
    expect(result.websiteUrl).toBe('https://example.com')
  })

  it('applies -50 penalty when no scrapeable URL exists', () => {
    const brand = makeBrand({
      description: 'Has a description that is long enough for points.',
      category: 'Food',
    })
    const result = scoreBrand(brand)
    expect(result.score).toBe(15 + 5 - 50)
    expect(result.websiteUrl).toBeNull()
  })

  it('extracts websiteUrl from officialWebsite first', () => {
    const brand = makeBrand({
      purchaseWebsite: 'https://brand.com',
      purchasePinkoi: 'https://pinkoi.com/store/x',
    })
    const result = scoreBrand(brand)
    expect(result.websiteUrl).toBe('https://brand.com')
  })

  it('falls back to pinkoi URL when no purchaseWebsite', () => {
    const brand = makeBrand({
      purchasePinkoi: 'https://pinkoi.com/store/x',
    })
    const result = scoreBrand(brand)
    expect(result.websiteUrl).toBe('https://pinkoi.com/store/x')
  })
})

describe('buildEnrichPatch', () => {
  const emptyScraped = {
    brandName: null,
    description: null,
    story: null,
    heroImageUrl: null,
    galleryImageUrls: [],
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    categoryHints: [],
    websiteUrl: 'https://example.com',
    rawJsonLd: null,
  }

  it('fills description when brand has none', () => {
    const brand = makeBrand({ description: null })
    const scraped = { ...emptyScraped, description: 'Scraped description text here.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBe('Scraped description text here.')
  })

  it('fills description when brand description is too short (< 20 chars)', () => {
    const brand = makeBrand({ description: 'Short' })
    const scraped = { ...emptyScraped, description: 'A much longer scraped description.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBe('A much longer scraped description.')
  })

  it('does NOT overwrite existing description when it is >= 20 chars', () => {
    const brand = makeBrand({ description: 'Existing description' })
    const scraped = { ...emptyScraped, description: 'Scraped description text here.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBeUndefined()
  })

  it('does NOT fill description when scraped description is too short (< 20 chars)', () => {
    const brand = makeBrand({ description: null })
    const scraped = { ...emptyScraped, description: 'Too short.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBeUndefined()
  })

  it('merges missing social links without overwriting existing', () => {
    const brand = makeBrand({
      socialInstagram: 'https://instagram.com/existing',
    })
    const scraped = {
      ...emptyScraped,
      socialInstagram: 'https://instagram.com/new',
      socialThreads: 'https://threads.net/new',
    }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.socialInstagram).toBeUndefined() // existing instagram should not be overwritten
    expect(patch.socialThreads).toBe('https://threads.net/new')
  })

  it('returns empty patch when nothing to fill', () => {
    const brand = makeBrand({
      description: 'Has everything',
      socialInstagram: 'https://instagram.com/x',
      socialThreads: 'https://threads.net/x',
      socialFacebook: 'https://facebook.com/x',
    })
    const patch = buildEnrichPatch(brand, emptyScraped)
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('does not include social fields in patch when no new links found', () => {
    const brand = makeBrand()
    const patch = buildEnrichPatch(brand, emptyScraped)
    expect(patch.socialInstagram).toBeUndefined()
    expect(patch.socialThreads).toBeUndefined()
    expect(patch.socialFacebook).toBeUndefined()
  })
})

describe('matchCategory', () => {
  it('matches clothing from name keyword', () => {
    expect(matchCategory('台灣外套品牌')).toBe('clothing')
  })

  it('matches footwear from description keyword', () => {
    expect(matchCategory('手工皮革鞋 精品手工製作')).toBe('footwear')
  })

  it('matches food from description keyword', () => {
    expect(matchCategory('傳統台灣麵條 古早味')).toBe('food')
  })

  it('matches beverages from name keyword', () => {
    expect(matchCategory('台灣高山茶')).toBe('beverages')
  })

  it('matches fragrance from description keyword', () => {
    expect(matchCategory('天然香氛蠟燭 精油擴香')).toBe('fragrance')
  })

  it('returns null when no keywords match', () => {
    expect(matchCategory('Brand Name Without Chinese Keywords')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(matchCategory('')).toBeNull()
  })

  it('respects priority order — clothing before footwear for overlapping text', () => {
    // clothing comes before footwear in CATEGORY_KEYWORDS
    expect(matchCategory('衣鞋品牌')).toBe('clothing')
  })
})
