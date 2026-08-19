import { describe, expect, it } from 'vitest'
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
  materialBySlug,
  isCompositeSubcategory,
  matchSubcategory,
  resolveSubcategorySlugs,
  subcategoryBySlug,
  subcategoryLabel,
  deriveCategoryLabel,
  categoryTint,
  RETIRED_COMPOSITE_LABELS,
} from '../ontology'

describe('L1_CATEGORIES', () => {
  it('has exactly 12 entries', () => {
    expect(L1_CATEGORIES).toHaveLength(12)
  })

  it('each entry has slug, name, nameZh, tint', () => {
    for (const cat of L1_CATEGORIES) {
      expect(cat.slug).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(cat.nameZh).toBeTruthy()
      expect(cat.tint).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/)
    }
  })

  it('contains all expected slugs', () => {
    const slugs = L1_CATEGORIES.map(c => c.slug)
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
    const slugs = L1_CATEGORIES.map(c => c.slug)
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

describe('deriveCategoryLabel', () => {
  it('returns the zh category name for a known category slug', () => {
    expect(deriveCategoryLabel('beauty')).toBe('美妝保養')
  })

  it('falls back to category note when no slug is selected', () => {
    expect(deriveCategoryLabel('', '香氛')).toBe('香氛')
  })

  it('returns null when neither category nor note is available', () => {
    expect(deriveCategoryLabel('', '   ')).toBeNull()
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

describe('L2_SUBCATEGORIES', () => {
  it('no subcategory names an occasion, packaging format, fulfilment mode or service', () => {
    const disqualifyingTokens = ['禮盒', '伴手禮', '彌月', '客製化', '體驗課程', '課程', '服務']
    const offenders = L2_SUBCATEGORIES.filter(subcategory =>
      disqualifyingTokens.some(token => subcategory.nameZh.includes(token)),
    ).map(subcategory => `${subcategory.slug} (${subcategory.nameZh})`)

    expect(offenders, `non-taxonomic L2s: ${offenders.join(', ')}`).toEqual([])
  })

  it("every subcategory's parent L1 exists", () => {
    const l1 = new Set(L1_CATEGORIES.map((c) => c.slug))
    for (const sub of L2_SUBCATEGORIES) {
      expect(l1.has(sub.category), `${sub.slug} parent ${sub.category}`).toBe(true)
    }
  })

  it('slugs are unique and kebab-case', () => {
    const slugs = L2_SUBCATEGORIES.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('canonical names and aliases are globally unambiguous', () => {
    const seen = new Map<string, string>()
    for (const sub of L2_SUBCATEGORIES) {
      for (const key of [sub.nameZh, sub.nameEn.toLowerCase(), ...sub.aliases]) {
        expect(seen.has(key), `duplicate match key "${key}" in ${sub.slug} and ${seen.get(key)}`).toBe(false)
        seen.set(key, sub.slug)
      }
    }
  })

  it('has entries for every L1 category', () => {
    const covered = new Set(L2_SUBCATEGORIES.map((s) => s.category))
    expect(covered.size).toBe(L1_CATEGORIES.length)
  })

  it('no new composite subcategories are added', () => {
    expect(L2_SUBCATEGORIES.filter(isCompositeSubcategory).length).toBeLessThanOrEqual(57)
  })

  it('registers the sixteen DEV-1361 atomic replacements with exclusive aliases', () => {
    const expected: Record<string, { nameZh: string; category: string; aliases: string[] }> = {
      'home-fragrance': { nameZh: '居家香氛', category: 'home', aliases: ['線香', '擴香', '香氛袋'] },
      candles: { nameZh: '蠟燭', category: 'home', aliases: [] },
      keychains: { nameZh: '鑰匙圈', category: 'bags-accessories', aliases: [] },
      charms: { nameZh: '吊飾', category: 'bags-accessories', aliases: [] },
      'storage-pouches': { nameZh: '收納包', category: 'bags-accessories', aliases: ['旅行收納包'] },
      'cosmetic-bags': { nameZh: '化妝包', category: 'bags-accessories', aliases: [] },
      'tea-bags': { nameZh: '茶包', category: 'food-drink', aliases: [] },
      'tea-drinks': { nameZh: '茶飲', category: 'food-drink', aliases: ['冷泡茶'] },
      toys: { nameZh: '玩具', category: 'kids-pets', aliases: ['布偶', '益智玩具'] },
      'learning-aids': { nameZh: '教具', category: 'kids-pets', aliases: [] },
      'floral-arrangements': { nameZh: '花藝', category: 'home', aliases: [] },
      plants: { nameZh: '植栽', category: 'home', aliases: ['盆栽'] },
      towels: { nameZh: '毛巾', category: 'home', aliases: ['浴巾'] },
      'home-textiles': { nameZh: '居家織品', category: 'home', aliases: ['抱枕', '毯'] },
      'phone-bags': { nameZh: '手機袋', category: 'bags-accessories', aliases: [] },
      'phone-straps': { nameZh: '手機背帶', category: 'bags-accessories', aliases: ['手機掛繩', '手機吊飾'] },
    }

    for (const [slug, value] of Object.entries(expected)) {
      expect(subcategoryBySlug(slug), `${slug} should exist`).toMatchObject(value)
    }
    expect(matchSubcategory('香氛')).toBeNull()
    expect(matchSubcategory('花器')).toBeNull()
    expect(matchSubcategory('花草茶')).toBeNull()
    expect(matchSubcategory('手機吊飾')?.slug).toBe('phone-straps')
    expect(matchSubcategory('吊飾')?.slug).toBe('charms')
  })
})

describe('MATERIALS', () => {
  const RATIFIED_ZH = [
    '陶瓷',
    '木',
    '織品',
    '玻璃',
    '金屬',
    '竹',
    '羊毛',
    '皮革',
    '紙',
    '石',
    '藤',
    '漆',
  ]

  it('materials_close_at_twelve_terms', () => {
    // The vocabulary is closed, not seeded: the CHECK constraint on
    // brands.material and curated_products.material mirrors this list, so an
    // addition here without a migration writes rows Postgres will reject.
    expect(MATERIALS).toHaveLength(12)
    expect(new Set(MATERIALS.map((m) => m.nameZh))).toEqual(new Set(RATIFIED_ZH))
  })

  it('material_slugs_are_ascii_kebab_case', () => {
    for (const material of MATERIALS) {
      expect(material.slug, `${material.nameZh} slug`).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(material.nameEn, `${material.nameZh} nameEn`).toBeTruthy()
    }
  })

  it('material_slugs_are_unique', () => {
    const slugs = MATERIALS.map((m) => m.slug)
    const namesZh = MATERIALS.map((m) => m.nameZh)
    expect(new Set(slugs).size, `duplicate slug in ${slugs.join(',')}`).toBe(slugs.length)
    expect(new Set(namesZh).size, `duplicate nameZh in ${namesZh.join(',')}`).toBe(
      namesZh.length,
    )
  })
})

describe('materialBySlug', () => {
  it('resolves a known slug to its material', () => {
    expect(materialBySlug('ceramic')?.nameZh).toBe('陶瓷')
    expect(materialBySlug('lacquer')?.nameZh).toBe('漆')
  })

  it('returns null for unknown slugs', () => {
    expect(materialBySlug('plastic')).toBeNull()
    expect(materialBySlug('')).toBeNull()
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

  it('does not resolve retired composite spellings while retaining the synonym pair', () => {
    for (const label of RETIRED_COMPOSITE_LABELS) {
      expect(matchSubcategory(label), `${label} should be retired`).toBeNull()
      expect(matchSubcategory(label.replace('・', '')), `${label} compact spelling should be retired`).toBeNull()
    }
    expect(matchSubcategory('卡片・明信片')?.slug).toBe('cards-and-postcards')
    expect(matchSubcategory('卡片明信片')?.slug).toBe('cards-and-postcards')
  })

  it('retired non-taxonomic labels no longer resolve', () => {
    for (const label of ['食品禮盒', '客製化禮品', '體驗課程・DIY材料', '彌月禮盒']) {
      expect(matchSubcategory(label), `${label} should be retired`).toBeNull()
    }
  })

  it('reparented subcategories resolve under their new L1', () => {
    expect(matchSubcategory('保健食品')?.category).toBe('food-drink')
    expect(matchSubcategory('手工具')?.category).toBe('home')
    expect(matchSubcategory('照護輔具')?.category).toBe('fitness')
    expect(matchSubcategory('按摩・放鬆')?.category).toBe('fitness')
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
