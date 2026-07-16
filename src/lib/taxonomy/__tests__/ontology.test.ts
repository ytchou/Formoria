import { describe, expect, it } from 'vitest'
import {
  PRODUCT_TYPE_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  matchSubcategory,
  resolveSubcategorySlugs,
  subcategoryBySlug,
  subcategoryLabel,
  deriveCategoryFromProductType,
  categoryTint,
} from '../ontology'

describe('PRODUCT_TYPE_CATEGORIES', () => {
  it('has exactly 12 entries', () => {
    expect(PRODUCT_TYPE_CATEGORIES).toHaveLength(12)
  })

  it('each entry has slug, name, nameZh, tint', () => {
    for (const cat of PRODUCT_TYPE_CATEGORIES) {
      expect(cat.slug).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(cat.nameZh).toBeTruthy()
      expect(cat.tint).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/)
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

describe('categoryTint', () => {
  it('returns tint for known category', () => {
    const result = categoryTint('fashion')
    expect(result).toBe('oklch(0.935 0.022 350)')
  })

  it('returns Warm Surface for null/undefined', () => {
    expect(categoryTint(null)).toBe('oklch(0.963 0.004 80)')
    expect(categoryTint(undefined)).toBe('oklch(0.963 0.004 80)')
  })

  it('returns Warm Surface for unknown slug', () => {
    expect(categoryTint('nonexistent')).toBe('oklch(0.963 0.004 80)')
  })
})

describe('PRODUCT_SUBCATEGORIES', () => {
  it('every subcategory has a valid L1 parent', () => {
    const l1 = new Set(PRODUCT_TYPE_CATEGORIES.map((c) => c.slug))
    for (const sub of PRODUCT_SUBCATEGORIES) {
      expect(l1.has(sub.category), `${sub.slug} parent ${sub.category}`).toBe(true)
    }
  })

  it('slugs are unique and kebab-case', () => {
    const slugs = PRODUCT_SUBCATEGORIES.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('canonical names and aliases are globally unambiguous', () => {
    const seen = new Map<string, string>()
    for (const sub of PRODUCT_SUBCATEGORIES) {
      for (const key of [sub.nameZh, sub.nameEn.toLowerCase(), ...sub.aliases]) {
        expect(seen.has(key), `duplicate match key "${key}" in ${sub.slug} and ${seen.get(key)}`).toBe(false)
        seen.set(key, sub.slug)
      }
    }
  })

  it('has entries for every L1 category', () => {
    const covered = new Set(PRODUCT_SUBCATEGORIES.map((s) => s.category))
    expect(covered.size).toBe(PRODUCT_TYPE_CATEGORIES.length)
  })
})

describe('matchSubcategory', () => {
  it('matches canonical zh name', () => {
    expect(matchSubcategory('托特包')?.slug).toBe('tote-bags')
  })
  it('matches aliases', () => {
    expect(matchSubcategory('側背包')?.slug).toBe('crossbody-bags')
    expect(matchSubcategory('斜挎包')?.slug).toBe('crossbody-bags')
    expect(matchSubcategory('樂福鞋')?.slug).toBe('leather-shoes')
  })
  it('matches EN names case-insensitively', () => {
    expect(matchSubcategory('tote bags')?.slug).toBe('tote-bags')
    expect(matchSubcategory('Tote Bags')?.slug).toBe('tote-bags')
  })
  it('normalizes whitespace and full-width characters', () => {
    expect(matchSubcategory(' 托特包 ')?.slug).toBe('tote-bags')
    expect(matchSubcategory('ｔｏｔｅ ｂａｇｓ')?.slug).toBe('tote-bags')
  })
  it('treats ・ variants as equivalent', () => {
    expect(matchSubcategory('皮夾・錢包')?.slug).toBe('wallets')
    expect(matchSubcategory('皮夾錢包')?.slug).toBe('wallets')
    expect(matchSubcategory('皮夾')?.slug).toBe('wallets')
  })
  it('returns null on no match', () => {
    expect(matchSubcategory('口金短夾')).toBeNull()
    expect(matchSubcategory('')).toBeNull()
  })
})

describe('subcategoryLabel', () => {
  it('returns locale-appropriate label', () => {
    const sub = matchSubcategory('托特包')!
    expect(subcategoryLabel(sub, 'zh-TW')).toBe('托特包')
    expect(subcategoryLabel(sub, 'en')).toBe('Tote Bags')
  })
})

describe('subcategoryBySlug', () => {
  it('resolves a known slug to its subcategory', () => {
    const sub = subcategoryBySlug('clasp-frame-bags')
    expect(sub?.nameZh).toBe('口金包')
    expect(sub?.category).toBe('bags-accessories')
  })

  it('returns null for unknown slugs', () => {
    expect(subcategoryBySlug('not-a-slug')).toBeNull()
  })
})

describe('resolveSubcategorySlugs', () => {
  it('keeps only slugs belonging to the given L1 category', () => {
    const subs = resolveSubcategorySlugs('bags-accessories', [
      'clasp-frame-bags',
      'tea',
      'bogus',
    ])
    expect(subs.map((s) => s.nameZh)).toEqual(['口金包'])
  })

  it('preserves input order and removes duplicate slugs', () => {
    const subs = resolveSubcategorySlugs('bags-accessories', [
      'tote-bags',
      'clasp-frame-bags',
      'tote-bags',
    ])
    expect(subs.map((s) => s.slug)).toEqual(['tote-bags', 'clasp-frame-bags'])
  })

  it('returns [] when category is null or slugs empty', () => {
    expect(resolveSubcategorySlugs(null, ['clasp-frame-bags'])).toEqual([])
    expect(resolveSubcategorySlugs('bags-accessories', [])).toEqual([])
  })
})
