import { describe, expect, it } from 'vitest'
import { processCleanupBrand } from '../curation-operations'

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
