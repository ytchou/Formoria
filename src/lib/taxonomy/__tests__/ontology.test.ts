import { describe, expect, it } from 'vitest'
import { PRODUCT_TYPE_CATEGORIES, deriveCategoryFromProductType } from '../ontology'

describe('PRODUCT_TYPE_CATEGORIES', () => {
  it('has exactly 12 entries', () => {
    expect(PRODUCT_TYPE_CATEGORIES).toHaveLength(12)
  })

  it('each entry has slug, name, nameZh', () => {
    for (const cat of PRODUCT_TYPE_CATEGORIES) {
      expect(cat.slug).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(cat.nameZh).toBeTruthy()
    }
  })

  it('contains all expected slugs', () => {
    const slugs = PRODUCT_TYPE_CATEGORIES.map(c => c.slug)
    expect(slugs).toContain('fashion')
    expect(slugs).toContain('bags-accessories')
    expect(slugs).toContain('jewelry')
    expect(slugs).toContain('beauty')
    expect(slugs).toContain('home')
    expect(slugs).toContain('food-drink')
    expect(slugs).toContain('crafts')
    expect(slugs).toContain('stationery')
    expect(slugs).toContain('tech')
    expect(slugs).toContain('outdoor')
    expect(slugs).toContain('fitness')
    expect(slugs).toContain('kids-pets')
  })

  it('does not contain old sub-category slugs', () => {
    const slugs = PRODUCT_TYPE_CATEGORIES.map(c => c.slug)
    expect(slugs).not.toContain('clothing')
    expect(slugs).not.toContain('footwear')
    expect(slugs).not.toContain('others')
    expect(slugs).not.toContain('baby-kids')
  })
})

describe('parentGroupForSlug (removed)', () => {
  it('is not exported', async () => {
    const mod = await import('../ontology')
    const exports = mod as Record<string, unknown>
    expect(exports.parentGroupForSlug).toBeUndefined()
    expect(exports.CATEGORY_ONTOLOGY).toBeUndefined()
  })
})

describe('deriveCategoryFromProductType', () => {
  it('returns the zh category name for a known product type slug', () => {
    expect(deriveCategoryFromProductType('beauty')).toBe('美妝保養')
  })

  it('falls back to product type note when no slug is selected', () => {
    expect(deriveCategoryFromProductType('', '香氛')).toBe('香氛')
  })

  it('returns null when neither product type nor note is available', () => {
    expect(deriveCategoryFromProductType('', '   ')).toBeNull()
  })
})
