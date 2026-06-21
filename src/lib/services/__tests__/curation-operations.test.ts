import { describe, expect, it } from 'vitest'
import {
  processAutoTagBrand,
  processCleanupBrand,
  processSetVisibilityBrand,
} from '../curation-operations'
import { processEnrichBrand, mergeEnrichPatches } from '../curation-operations'

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

describe('processAutoTagBrand', () => {
  it('assigns category based on brand name keywords', () => {
    const brand = {
      id: '1',
      display_brand_name: '台灣茶葉精選',
      description: '精選台灣高山茶',
      product_type: null,
    }
    const result = processAutoTagBrand(brand)
    expect(result.category).not.toBeNull()
    expect(result.changed).toBe(true)
  })

  it('skips brand that already has a category', () => {
    const brand = {
      id: '1',
      display_brand_name: '台灣茶葉精選',
      description: '精選台灣高山茶',
      product_type: 'Food & Beverage',
    }
    const result = processAutoTagBrand(brand)
    expect(result.changed).toBe(false)
  })

  it('returns null category when no keywords match', () => {
    const brand = {
      id: '1',
      display_brand_name: 'Generic Brand',
      description: 'A brand',
      product_type: null,
    }
    const result = processAutoTagBrand(brand)
    expect(result.category).toBeNull()
    expect(result.changed).toBe(false)
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
