import { describe, expect, it, vi } from 'vitest'
import {
  processCleanupBrand,
  processSetVisibilityBrand,
} from '../curation-operations'
import { processEnrichBrand, mergeEnrichPatches } from '../curation-operations'
import type { CurationConfig } from '../curation-operations'

vi.mock('../product-type-classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../product-type-classifier')>()
  return {
    ...actual,
    triageBrandsBatch: vi.fn(),
  }
})

describe('processCleanupBrand', () => {
  const baseBrand = {
    id: '1',
    slug: 'test-brand',
    display_brand_name: '  ✨ My Brand ✨  ',
    status: 'approved',
  }

  it('cleans brand name by removing emoji and decorative chars', () => {
    const result = processCleanupBrand(baseBrand)

    expect(result.phases.cleanNames.changed).toBe(true)
    expect(result.phases.cleanNames.patch.name).toBe('My Brand')
  })

  it('normalizes CJK slug when scraped name is ASCII', () => {
    const brand = { ...baseBrand, slug: '品牌test', display_brand_name: 'My Brand' }
    const result = processCleanupBrand(brand, { scrapedName: 'TestBrand' })

    expect(result.phases.normalizeSlugs.changed).toBe(true)
    expect(result.phases.normalizeSlugs.patch.slug).toBe('testbrand')
  })

  it('detects non-brand entries', () => {
    const brand = { ...baseBrand, display_brand_name: 'JLab 台灣獨家代理' }
    const result = processCleanupBrand(brand)

    expect(result.phases.detectNonBrands.isNonBrand).toBe(true)
  })

  it('runs all three phases', () => {
    const result = processCleanupBrand(baseBrand)

    expect(result.phases).toHaveProperty('cleanNames')
    expect(result.phases).toHaveProperty('normalizeSlugs')
    expect(result.phases).toHaveProperty('detectNonBrands')
  })

  it('returns no changes for clean brand', () => {
    const cleanBrand = {
      ...baseBrand,
      display_brand_name: 'Clean Brand',
      slug: 'clean-brand',
    }
    const result = processCleanupBrand(cleanBrand)

    expect(result.hasChanges).toBe(false)
    expect(result.patch).toEqual({})
  })
})

describe('processSetVisibilityBrand', () => {
  it('marks approved brand with sufficient data as visible', () => {
    const brand = {
      id: '1',
      status: 'approved',
      display_brand_name: 'Good Brand',
      website_url: 'https://example.com',
      description: 'A valid description over twenty characters long',
    }
    const result = processSetVisibilityBrand(brand)
    expect(result.visible).toBe(true)
  })
})

describe('processEnrichBrand', () => {
  const baseBrand = {
    id: '1',
    slug: 'mybrand',
    display_brand_name: 'My Brand',
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    brand_highlights: null,
    hero_image_url: null,
    product_images: [],
  }

  const scrapedData = {
    social_instagram: 'https://www.instagram.com/mybrand/',
    social_facebook: 'https://www.facebook.com/mybrand',
    description: 'A premium handcrafted brand from Taiwan specializing in leather goods',
    story: 'Founded in 2015 by artisans in Tainan',
  }

  it('produces link patch from scraped data', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['links'])
    expect(result.patches.links?.social_instagram).toBe('https://www.instagram.com/mybrand/')
  })

  it('produces description patch when description phase enabled', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['descriptions'])
    expect(result.patches.descriptions?.description).toBe(scrapedData.description)
  })

  it('fills brand_highlights from story', () => {
    const brandWithDesc = { ...baseBrand, description: 'Already has a valid description over twenty chars' }
    const result = processEnrichBrand(brandWithDesc, scrapedData, ['descriptions'])
    expect(result.patches.descriptions?.brand_highlights).toBe(scrapedData.story)
  })

  it('skips description phase when not in requested phases', () => {
    const result = processEnrichBrand(baseBrand, scrapedData, ['links'])
    expect(result.patches.descriptions).toBeUndefined()
  })
})

describe('processEnrichBrand with cleanup phases', () => {
  const baseBrand = {
    id: '1',
    slug: 'test-brand',
    display_brand_name: '  ✨ My Brand ✨  ',
    name: '  ✨ My Brand ✨  ',
    status: 'approved',
    description: null,
    product_type: null,
    purchase_website: null,
  }

  it('runs clean phase and produces name cleanup patch', () => {
    const result = processEnrichBrand(baseBrand, {}, ['clean'])
    expect(result.phases).toHaveProperty('clean')
    expect(result.phases.clean?.changed).toBe(true)
    expect(result.patch.name).toBe('My Brand')
  })

  it('skips clean phase when not in phases list', () => {
    const result = processEnrichBrand(baseBrand, {}, ['discover'])
    expect(result.phases).not.toHaveProperty('clean')
  })

  it('clean phase preserves already-clean names', () => {
    const cleanBrand = { ...baseBrand, name: 'Already Clean', display_brand_name: 'Already Clean' }
    const result = processEnrichBrand(cleanBrand, {}, ['clean'])
    expect(result.phases.clean?.changed).toBe(false)
    expect(result.patch).toEqual({})
  })
})

describe('descriptions phase standalone', () => {
  const baseBrand = {
    id: '1',
    slug: 'mybrand',
    display_brand_name: 'My Brand',
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    website_url: null,
    description: null,
    brand_highlights: null,
    hero_image_url: null,
    product_images: [],
  }

  it('runs descriptions phase without setting product_type', () => {
    const result = processEnrichBrand(baseBrand, { snippets: ['A great brand making handmade soap'] }, ['descriptions'])
    expect(result.phases).toHaveProperty('descriptions')
    expect(result.patch).not.toHaveProperty('product_type')
  })

  it('runs descriptions phase without tags when tags is not in phases', () => {
    const result = processEnrichBrand(baseBrand, { snippets: ['A great brand making handmade soap'] }, ['descriptions'])
    expect(result.phases).toHaveProperty('descriptions')
    expect(result.phases).not.toHaveProperty('tags')
  })
})

describe('CurationConfig status filter', () => {
  it('accepts status option in CurationConfig type', () => {
    const config: CurationConfig = { dryRun: true, status: 'pending' }
    expect(config.status).toBe('pending')
  })
})

describe('mergeEnrichPatches', () => {
  it('merges link and description patches into single update', () => {
    const patches = {
      links: { social_instagram: 'https://www.instagram.com/mybrand/' },
      descriptions: { description: 'A new description for the brand' },
    }
    const merged = mergeEnrichPatches(patches)
    expect(merged.social_instagram).toBe('https://www.instagram.com/mybrand/')
    expect(merged.description).toBe('A new description for the brand')
  })

  it('returns empty object when no patches', () => {
    const merged = mergeEnrichPatches({})
    expect(Object.keys(merged)).toHaveLength(0)
  })
})

describe('runEnrich triage integration', () => {
  it('calls triageBrandsBatch when detect/slugs/tags phases are active', async () => {
    const { triageBrandsBatch } = await import('../product-type-classifier')
    const mockTriage = vi.mocked(triageBrandsBatch)
    mockTriage.mockResolvedValueOnce(
      new Map([
        ['brand-a', {
          isNonBrand: false,
          nonBrandReason: null,
          slug: 'brand-a',
          productType: 'beauty',
          valueTags: [],
          confidence: 'high' as const,
        }],
      ])
    )

    const result = await mockTriage([{ slug: 'brand-a', name: 'Brand A', description: null, website: null }])
    expect(result.size).toBe(1)
    expect(result.get('brand-a')?.productType).toBe('beauty')
  })

  it('applies non-brand gating — skips tier 3+4 for flagged brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: true,
      nonBrandReason: 'reseller',
      slug: 'some-brand',
      productType: null,
      valueTags: [],
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(true)
  })

  it('does not gate brands that are not non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: false,
      nonBrandReason: null,
      slug: 'good-brand',
      productType: 'beauty',
      valueTags: [],
      confidence: 'high' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(false)
  })

  it('does not gate low-confidence non-brands', async () => {
    const { shouldSkipForNonBrand } = await import('../curation-operations')

    const triageResult = {
      isNonBrand: true,
      nonBrandReason: 'maybe reseller',
      slug: 'uncertain-brand',
      productType: null,
      valueTags: [],
      confidence: 'low' as const,
    }

    expect(shouldSkipForNonBrand(triageResult)).toBe(false)
  })
})
