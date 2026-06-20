/// <reference types="vitest/globals" />

import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Brand, BrandFlatLinkColumns } from '@/lib/types'
import type { ScrapedBrandData } from '@/lib/types/scraper'
import {
  scoreBrand,
  buildEnrichPatch,
  buildImageEnrichPatch,
  buildLinkEnrichPatch,
  matchCategory,
  cleanNames,
  detectNonBrands,
  collectPurchaseLinks,
  findBrandsNeedingEnrichment,
  findBrandsNeedingImages,
  findBrandsNeedingLinks,
  findSlugsNeedingNormalization,
  validateLink,
} from '../curate-brands'

type BrandWithLinkColumns = Brand & BrandFlatLinkColumns
type ImageBrandFixture = {
  id: string
  status: string
  heroImageUrl: string | null
  productPhotos: string[] | null
}
type PurchaseLinkFixture = {
  purchasePinkoi: string | null
  purchaseShopee: string | null
  purchaseWebsite: string | null
}

function makeBrand(overrides: Partial<BrandWithLinkColumns> = {}): BrandWithLinkColumns {
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

function emptyScraped(): ScrapedBrandData {
  return {
    brandName: null,
    description: null,
    story: null,
    heroImageUrl: null,
    galleryImageUrls: [],
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    categoryHints: [],
    websiteUrl: 'https://example.com',
    rawJsonLd: null,
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
  it('fills description when brand has none', () => {
    const brand = makeBrand({ description: null })
    const scraped = { ...emptyScraped(), description: 'Scraped description text here.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBe('Scraped description text here.')
  })

  it('fills description when brand description is too short (< 20 chars)', () => {
    const brand = makeBrand({ description: 'Short' })
    const scraped = { ...emptyScraped(), description: 'A much longer scraped description.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBe('A much longer scraped description.')
  })

  it('does NOT overwrite existing description when it is >= 20 chars', () => {
    const brand = makeBrand({ description: 'Existing description' })
    const scraped = { ...emptyScraped(), description: 'Scraped description text here.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBeUndefined()
  })

  it('does NOT fill description when scraped description is too short (< 20 chars)', () => {
    const brand = makeBrand({ description: null })
    const scraped = { ...emptyScraped(), description: 'Too short.' }
    const patch = buildEnrichPatch(brand, scraped)
    expect(patch.description).toBeUndefined()
  })

  it('merges missing social links without overwriting existing', () => {
    const brand = makeBrand({
      socialInstagram: 'https://instagram.com/existing',
    })
    const scraped = {
      ...emptyScraped(),
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
    const patch = buildEnrichPatch(brand, emptyScraped())
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('does not include social fields in patch when no new links found', () => {
    const brand = makeBrand()
    const patch = buildEnrichPatch(brand, emptyScraped())
    expect(patch.socialInstagram).toBeUndefined()
    expect(patch.socialThreads).toBeUndefined()
    expect(patch.socialFacebook).toBeUndefined()
  })
})

describe('buildLinkEnrichPatch', () => {
  it('fills missing purchase links from scraped data', () => {
    const brand = makeBrand({
      purchase_pinkoi: null,
      purchase_shopee: null,
    })
    const scraped = {
      ...emptyScraped(),
      purchasePinkoi: 'https://pinkoi.com/store/test',
      purchaseShopee: 'https://shopee.tw/test',
    }

    const patch = buildLinkEnrichPatch(brand, scraped)

    expect(patch).toEqual({
      purchase_pinkoi: 'https://pinkoi.com/store/test',
      purchase_shopee: 'https://shopee.tw/test',
    })
  })

  it('fills missing social links from scraped data', () => {
    const brand = makeBrand({
      social_instagram: null,
      social_threads: 'https://threads.net/existing',
    })
    const scraped = {
      ...emptyScraped(),
      socialInstagram: 'https://instagram.com/test',
      socialThreads: 'https://threads.net/new',
    }

    const patch = buildLinkEnrichPatch(brand, scraped)

    expect(patch).toEqual({
      social_instagram: 'https://instagram.com/test',
    })
  })

  it('does not overwrite existing links', () => {
    const brand = makeBrand({
      purchase_pinkoi: 'https://pinkoi.com/store/existing',
    })
    const scraped = {
      ...emptyScraped(),
      purchasePinkoi: 'https://pinkoi.com/store/new',
    }

    const patch = buildLinkEnrichPatch(brand, scraped)

    expect(patch.purchase_pinkoi).toBeUndefined()
  })

  it('returns empty patch when brand has all links', () => {
    const brand = makeBrand({
      social_instagram: 'https://instagram.com/test',
      social_threads: 'https://threads.net/test',
      social_facebook: 'https://facebook.com/test',
      purchase_website: 'https://example.com',
      purchase_pinkoi: 'https://pinkoi.com/store/test',
      purchase_shopee: 'https://shopee.tw/test',
    })
    const scraped = {
      ...emptyScraped(),
      socialInstagram: 'https://instagram.com/new',
      socialThreads: 'https://threads.net/new',
      socialFacebook: 'https://facebook.com/new',
      purchaseWebsite: 'https://new.example.com',
      purchasePinkoi: 'https://pinkoi.com/store/new',
      purchaseShopee: 'https://shopee.tw/new',
    }

    const patch = buildLinkEnrichPatch(brand, scraped)

    expect(patch).toEqual({})
  })

  it('returns empty patch when scraped has no links', () => {
    const brand = makeBrand({ purchase_pinkoi: null })

    const patch = buildLinkEnrichPatch(brand, emptyScraped())

    expect(patch).toEqual({})
  })
})

describe('buildImageEnrichPatch', () => {
  const baseBrand = {
    id: 'brand-1',
    heroImageUrl: null,
    productPhotos: null,
  }

  it('sets heroImageUrl from scraped heroImageUrl when brand has none', () => {
    const patch = buildImageEnrichPatch(
      baseBrand as unknown as Brand,
      { heroImageUrl: 'https://cdn01.pinkoi.com/product/hero.jpg', galleryImageUrls: [] } as unknown as ScrapedBrandData,
      ['https://supabase.co/storage/hero-stored.webp']
    )
    expect(patch.heroImageUrl).toBe('https://supabase.co/storage/hero-stored.webp')
  })

  it('does not overwrite existing heroImageUrl', () => {
    const patch = buildImageEnrichPatch(
      { ...baseBrand, heroImageUrl: 'https://existing.com/hero.jpg' } as unknown as Brand,
      { heroImageUrl: 'https://cdn01.pinkoi.com/product/new-hero.jpg', galleryImageUrls: [] } as unknown as ScrapedBrandData,
      ['https://supabase.co/storage/new-hero-stored.webp']
    )
    expect(patch.heroImageUrl).toBeUndefined()
  })

  it('uses first gallery image as hero fallback and excludes it from productPhotos', () => {
    const patch = buildImageEnrichPatch(
      baseBrand as unknown as Brand,
      {
        heroImageUrl: null,
        galleryImageUrls: ['https://cdn01.pinkoi.com/product/1.jpg', 'https://cdn01.pinkoi.com/product/2.jpg'],
      } as unknown as ScrapedBrandData,
      ['https://supabase.co/storage/photo1.webp', 'https://supabase.co/storage/photo2.webp']
    )
    expect(patch.heroImageUrl).toBe('https://supabase.co/storage/photo1.webp')
    expect(patch.productPhotos).toEqual([
      'https://supabase.co/storage/photo2.webp',
    ])
  })

  it('appends to existing productPhotos without exceeding MAX_PRODUCT_PHOTOS', () => {
    const existing = [
      'https://supabase.co/storage/existing1.webp',
      'https://supabase.co/storage/existing2.webp',
      'https://supabase.co/storage/existing3.webp',
      'https://supabase.co/storage/existing4.webp',
    ]
    const patch = buildImageEnrichPatch(
      { ...baseBrand, heroImageUrl: 'https://existing.com/hero.jpg', productPhotos: existing } as unknown as Brand,
      {
        heroImageUrl: null,
        galleryImageUrls: ['https://cdn01.pinkoi.com/product/new1.jpg', 'https://cdn01.pinkoi.com/product/new2.jpg'],
      } as unknown as ScrapedBrandData,
      ['https://supabase.co/storage/new1.webp', 'https://supabase.co/storage/new2.webp']
    )
    expect(patch.productPhotos).toHaveLength(5)
    expect(patch.productPhotos![0]).toBe('https://supabase.co/storage/existing1.webp')
    expect(patch.productPhotos![4]).toBe('https://supabase.co/storage/new1.webp')
  })

  it('returns empty patch when no images scraped', () => {
    const patch = buildImageEnrichPatch(
      baseBrand as unknown as Brand,
      { heroImageUrl: null, galleryImageUrls: [] } as unknown as ScrapedBrandData,
      []
    )
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('uses first gallery image as hero fallback when heroImageUrl is null but gallery has images', () => {
    const patch = buildImageEnrichPatch(
      baseBrand as unknown as Brand,
      {
        heroImageUrl: null,
        galleryImageUrls: ['https://cdn01.pinkoi.com/product/1.jpg'],
      } as unknown as ScrapedBrandData,
      ['https://supabase.co/storage/photo1.webp']
    )
    expect(patch.heroImageUrl).toBe('https://supabase.co/storage/photo1.webp')
  })
})

describe('findBrandsNeedingLinks', () => {
  it('excludes brands with all 6 links filled', () => {
    const brands = [
      makeBrand({
        status: 'approved',
        social_instagram: 'https://instagram.com/test',
        social_threads: 'https://threads.net/test',
        social_facebook: 'https://facebook.com/test',
        purchase_website: 'https://example.com',
        purchase_pinkoi: 'https://pinkoi.com/store/test',
        purchase_shopee: 'https://shopee.tw/test',
      }),
    ]

    expect(findBrandsNeedingLinks(brands)).toHaveLength(0)
  })

  it('includes approved brands with at least one missing link', () => {
    const brands = [
      makeBrand({
        status: 'approved',
        social_instagram: 'https://instagram.com/test',
        social_threads: null,
        social_facebook: 'https://facebook.com/test',
        purchase_website: 'https://example.com',
        purchase_pinkoi: 'https://pinkoi.com/store/test',
        purchase_shopee: 'https://shopee.tw/test',
      }),
    ]

    expect(findBrandsNeedingLinks(brands)).toHaveLength(1)
  })

  it('excludes non-approved brands', () => {
    const brands = [
      makeBrand({
        status: 'pending',
        social_instagram: null,
      }),
    ]

    expect(findBrandsNeedingLinks(brands)).toHaveLength(0)
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

  it('prevents duplicate newSlug assignments within a single run', () => {
    const brands = [
      makeBrand({ slug: '品牌一', name: 'Same Name' }),
      makeBrand({ slug: '品牌二', name: 'Same Name' }),
    ]

    const results = findSlugsNeedingNormalization(brands)

    expect(results).toHaveLength(1)
    expect(results[0].slug).toBe('品牌一')
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

describe('validateLink', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns true when brand name found in page content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html><body>Welcome to Hanchor official store</body></html>')
    ))
    expect(await validateLink('https://pinkoi.com/store/hanchor', 'Hanchor')).toBe(true)
  })

  it('returns false when brand name not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html><body>Some unrelated page</body></html>')
    ))
    expect(await validateLink('https://pinkoi.com/store/other', 'Hanchor')).toBe(false)
  })

  it('returns false when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    expect(await validateLink('https://broken.com', 'Hanchor')).toBe(false)
  })

  it('matches brand name case-insensitively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html><body>HANCHOR brand page</body></html>')
    ))
    expect(await validateLink('https://example.com', 'hanchor')).toBe(true)
  })
})

describe('findBrandsNeedingImages', () => {
  it('includes brands with no heroImageUrl', () => {
    const brands: ImageBrandFixture[] = [
      { id: '1', status: 'approved', heroImageUrl: null, productPhotos: null },
      { id: '2', status: 'approved', heroImageUrl: 'https://supabase.co/hero.webp', productPhotos: ['a.webp', 'b.webp', 'c.webp'] },
    ]
    const result = findBrandsNeedingImages(brands as unknown as Brand[])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('includes brands with fewer than 2 productPhotos', () => {
    const brands: ImageBrandFixture[] = [
      { id: '1', status: 'approved', heroImageUrl: 'https://supabase.co/hero.webp', productPhotos: null },
      { id: '2', status: 'approved', heroImageUrl: 'https://supabase.co/hero.webp', productPhotos: ['a.webp'] },
      { id: '3', status: 'approved', heroImageUrl: 'https://supabase.co/hero.webp', productPhotos: ['a.webp', 'b.webp'] },
    ]
    const result = findBrandsNeedingImages(brands as unknown as Brand[])
    expect(result).toHaveLength(2)
    expect(result.map((brand) => brand.id)).toEqual(['1', '2'])
  })
})

describe('collectPurchaseLinks', () => {
  it('collects non-null purchase links from brand', () => {
    const brand: PurchaseLinkFixture = {
      purchasePinkoi: 'https://www.pinkoi.com/store/abc',
      purchaseShopee: null,
      purchaseWebsite: 'https://brand.com',
    }
    const links = collectPurchaseLinks(brand as unknown as Brand)
    expect(links).toEqual([
      'https://www.pinkoi.com/store/abc',
      'https://brand.com',
    ])
  })

  it('returns empty array when no purchase links exist', () => {
    const brand: PurchaseLinkFixture = {
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseWebsite: null,
    }
    const links = collectPurchaseLinks(brand as unknown as Brand)
    expect(links).toEqual([])
  })

  it('prioritizes Pinkoi first, then Shopee, then website', () => {
    const brand: PurchaseLinkFixture = {
      purchasePinkoi: 'https://pinkoi.com/store/abc',
      purchaseShopee: 'https://shopee.tw/shop/123',
      purchaseWebsite: 'https://brand.com',
    }
    const links = collectPurchaseLinks(brand as unknown as Brand)
    expect(links[0]).toContain('pinkoi.com')
    expect(links[1]).toContain('shopee.tw')
    expect(links[2]).toContain('brand.com')
  })
})
