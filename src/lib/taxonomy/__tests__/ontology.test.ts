import { describe, expect, it } from 'vitest'
import { PRODUCT_TYPE_CATEGORIES } from '../ontology'

describe('PRODUCT_TYPE_CATEGORIES', () => {
  it('has exactly 10 entries', () => {
    expect(PRODUCT_TYPE_CATEGORIES).toHaveLength(10)
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
    expect(slugs).toContain('tech')
    expect(slugs).toContain('outdoor')
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
