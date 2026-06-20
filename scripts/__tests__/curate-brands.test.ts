import { describe, it, expect } from 'vitest'
import type { Brand } from '@/lib/types'
import {
  scoreBrand,
  buildEnrichPatch,
  matchCategory,
  cleanNames,
  detectNonBrands,
  findBrandsNeedingEnrichment,
  findSlugsNeedingNormalization,
} from '../curate-brands'

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

describe('cleanNames', () => {
  it('returns only changed brands', () => {
    const brands = [
      makeBrand({ slug: 'dirty', name: '梨大爺🥑' }),
      makeBrand({ slug: 'clean', name: 'AROMASE 艾瑪絲' }),
    ]
    const results = cleanNames(brands)
    expect(results).toHaveLength(1)
    expect(results[0].slug).toBe('dirty')
    expect(results[0].cleanedName).toBe('梨大爺')
    expect(results[0].originalName).toBe('梨大爺🥑')
    expect(results[0].patternsMatched).toContain('emoji')
    expect(results[0].confidence).toBe('high')
  })

  it('returns empty array when all names are clean', () => {
    const brands = [
      makeBrand({ name: 'AROMASE 艾瑪絲' }),
      makeBrand({ name: "O'right 歐萊德" }),
    ]
    expect(cleanNames(brands)).toHaveLength(0)
  })
})

describe('detectNonBrands', () => {
  it('returns only non-brand entries', () => {
    const brands = [
      makeBrand({ slug: 'reseller', name: 'JLab 台灣獨家代理' }),
      makeBrand({ slug: 'normal', name: 'AROMASE 艾瑪絲' }),
      makeBrand({ slug: 'charity', name: '某某基金會' }),
    ]
    const results = detectNonBrands(brands)
    expect(results).toHaveLength(2)
    expect(results.map(r => r.slug)).toContain('reseller')
    expect(results.map(r => r.slug)).toContain('charity')
  })

  it('returns empty array when all are real brands', () => {
    const brands = [
      makeBrand({ name: 'AROMASE 艾瑪絲' }),
      makeBrand({ name: "O'right 歐萊德" }),
    ]
    expect(detectNonBrands(brands)).toHaveLength(0)
  })
})

describe('enrichDescriptions', () => {
  it('filters to brands needing enrichment', () => {
    const brands = [
      makeBrand({ slug: 'missing', description: null }),
      makeBrand({ slug: 'short', description: 'Too short' }),
      makeBrand({
        slug: 'adequate',
        description: 'This description already has enough useful detail.',
      }),
    ]

    const results = findBrandsNeedingEnrichment(brands)

    expect(results.map((brand) => brand.slug)).toEqual(['missing', 'short'])
  })

  it('treats description equal to brand name as missing', () => {
    const brands = [
      makeBrand({ slug: 'same-as-name', name: 'Same Brand', description: 'Same Brand' }),
    ]

    const results = findBrandsNeedingEnrichment(brands)

    expect(results.map((brand) => brand.slug)).toEqual(['same-as-name'])
  })

  it('includes empty string descriptions', () => {
    const brands = [
      makeBrand({ slug: 'empty-description', description: '' }),
    ]

    const results = findBrandsNeedingEnrichment(brands)

    expect(results.map((brand) => brand.slug)).toEqual(['empty-description'])
  })
})

describe('normalizeSlugs', () => {
  it('identifies CJK slugs needing normalization', () => {
    const brands = [
      makeBrand({ slug: '慢慢挑', name: 'Man Man Tiao' }),
      makeBrand({ slug: 'aromase', name: 'AROMASE 艾瑪絲' }),
      makeBrand({ slug: '採花女孩', name: '採花女孩' }),
    ]

    const results = findSlugsNeedingNormalization(brands)

    expect(results).toEqual([
      {
        slug: '慢慢挑',
        newSlug: 'man-man-tiao',
        name: 'Man Man Tiao',
        source: 'scraped-english-name',
      },
    ])
  })

  it('skips already-English slugs', () => {
    const brands = [
      makeBrand({ slug: 'man-man-tiao', name: 'Man Man Tiao' }),
    ]

    expect(findSlugsNeedingNormalization(brands)).toHaveLength(0)
  })

  it('checks slug uniqueness', () => {
    const brands = [
      makeBrand({ slug: '慢慢挑', name: 'Man Man Tiao' }),
      makeBrand({ slug: 'man-man-tiao', name: 'Existing Brand' }),
    ]

    expect(findSlugsNeedingNormalization(brands)).toHaveLength(0)
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
