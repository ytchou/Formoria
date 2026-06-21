import { describe, expect, it } from 'vitest'
import {
  processAutoTagBrand,
  processCleanupBrand,
  processSetVisibilityBrand,
} from '../curation-operations'

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
    expect(result.phases.cleanNames.patch.display_brand_name).toBe('My Brand')
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
