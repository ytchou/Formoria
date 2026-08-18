import { describe, it, expect } from 'vitest'
import {
  normalizeSubcategories,
  deriveSubcategoriesEn,
  planSubcategoryBackfill,
  novelSubcategoryRejection,
  resolveSubcategoryInput,
  applySubcategoryDelta,
  deriveCategoryFromSubcategories,
} from '../subcategories'

describe('normalizeSubcategories', () => {
  it('replaces vocab matches with canonical zh/en pairs', () => {
    const result = normalizeSubcategories(['側背包', '托特包'], ['crossbody', 'tote'])
    expect(result.subcategories).toEqual(['斜背包', '托特包'])
    expect(result.subcategoriesEn).toEqual(['Crossbody Bags', 'Tote Bags'])
  })

  it('collapses SKU variants that map to the same canonical', () => {
    const result = normalizeSubcategories(
      ['口金零錢包', '口金夾', '登山背包'],
      ['clasp coin purse', 'clasp wallet', 'hiking backpack'],
    )
    expect(result.subcategories).toEqual(['口金包', '後背包'])
    expect(result.subcategoriesEn).toEqual(['Clasp-Frame Bags', 'Backpacks'])
  })

  it('keeps heuristic-clean novel subcategories with their EN, zh fallback when EN missing', () => {
    const result = normalizeSubcategories(['手工燈籠'], [])
    expect(result.subcategories).toEqual(['手工燈籠'])
    expect(result.subcategoriesEn).toEqual(['手工燈籠'])
  })

  it('title-cases a novel subcategory EN so it matches ontology casing on cards', () => {
    const result = normalizeSubcategories(
      ['手工燈籠', '雨鞋', '臉部防曬'],
      ['handmade lantern', 'rain boots', 'facial sunscreen'],
    )
    expect(result.subcategoriesEn).toEqual(['Handmade Lantern', 'Rain Boots', 'Facial Sunscreen'])
  })

  it('leaves an already-capitalized novel subcategory EN and its inner casing alone', () => {
    const result = normalizeSubcategories(
      ['手工燈籠', '無線充電盤'],
      ['Handmade Lantern', 'USB-C charging pad'],
    )
    expect(result.subcategoriesEn).toEqual(['Handmade Lantern', 'USB-C Charging Pad'])
  })

  it('drops blocklisted and out-of-band novel subcategories, recording rejections', () => {
    const result = normalizeSubcategories(
      ['藍鵲系列襪子', '超值限定組', '襪'],
      ['bluebird series socks', 'limited set', 'sock'],
    )
    expect(result.subcategories).toEqual([])
    expect(result.rejected.map((r) => r.subcategory)).toEqual(['藍鵲系列襪子', '超值限定組', '襪'])
  })

  it('caps at 5 and keeps arrays paired', () => {
    const zh = ['托特包', '後背包', '斜背包', '手提包', '水桶包', '零錢包']
    const result = normalizeSubcategories(zh, [])
    expect(result.subcategories).toHaveLength(5)
    expect(result.subcategoriesEn).toHaveLength(5)
  })

  it('flags cross-branch picks when brandCategory provided', () => {
    const result = normalizeSubcategories(['手工皂'], [], 'fashion')
    expect(result.crossBranch).toEqual(['手工皂'])
  })

  it('splits an unmatched composite tag and keeps the halves that resolve', () => {
    const result = normalizeSubcategories(['糖果・糕點'], [])

    expect(result.subcategories).toEqual(['甜點・糕點'])
    expect(result.subcategoriesEn).toEqual(['Desserts & Pastries'])
    expect(result.subcategories).not.toContain('糖果・糕點')
  })

  it('keeps a canonical composite tag untouched', () => {
    const result = normalizeSubcategories(['甜點・糕點'], [])

    expect(result.subcategories).toEqual(['甜點・糕點'])
    expect(result.subcategoriesEn).toEqual(['Desserts & Pastries'])
  })

  it('rejects retired split composites after canonical synonym matching', () => {
    const result = normalizeSubcategories(['香氛・蠟燭', '香氛蠟燭'], [])

    expect(result.subcategories).toEqual([])
    expect(result.rejected).toEqual([
      { subcategory: '香氛・蠟燭', reason: 'retired-composite' },
      { subcategory: '香氛蠟燭', reason: 'retired-composite' },
    ])
    expect(resolveSubcategoryInput('香氛・蠟燭')).toEqual({
      ok: false,
      reason: 'retired-composite',
    })
    expect(resolveSubcategoryInput('卡片・明信片')).toEqual({
      ok: true,
      subcategory: '卡片・明信片',
      canonical: true,
    })
    expect(resolveSubcategoryInput('手機吊飾')).toEqual({
      ok: true,
      subcategory: '手機背帶',
      canonical: true,
    })
  })

  it('drops an unmatched composite when neither half resolves', () => {
    const result = normalizeSubcategories(['地板・地板材料'], [])

    expect(result.subcategories).not.toContain('地板・地板材料')
    expect(result.subcategories).toEqual([])
  })

  it('preserves a non-composite novel subcategory', () => {
    const result = normalizeSubcategories(['雨傘'], [])

    expect(result.subcategories).toEqual(['雨傘'])
  })
})

describe('deriveCategoryFromSubcategories', () => {
  it('derives the only ontology category represented by accepted subcategories', () => {
    expect(deriveCategoryFromSubcategories(['家具', '地板材料', '天花板材料'])).toBe('home')
  })

  it('uses the unique category winner when recognized subcategories span categories', () => {
    expect(deriveCategoryFromSubcategories(['休閒鞋', '洋裝', '家具'])).toBe('fashion')
  })

  it('leaves tied or entirely novel subcategory sets uncategorized', () => {
    expect(deriveCategoryFromSubcategories(['休閒鞋', '家具'])).toBeNull()
    expect(deriveCategoryFromSubcategories(['學步鞋', '機能鞋'])).toBeNull()
  })
})

describe('resolveSubcategoryInput', () => {
  it('resolves an exact canonical nameZh to itself', () => {
    expect(resolveSubcategoryInput('洋裝')).toEqual({
      ok: true,
      subcategory: '洋裝',
      canonical: true,
    })
  })

  it('canonicalizes a known alias to its nameZh', () => {
    expect(resolveSubcategoryInput('T恤')).toEqual({
      ok: true,
      subcategory: '上衣・T恤',
      canonical: true,
    })
  })

  it('canonicalizes an English name to its nameZh', () => {
    expect(resolveSubcategoryInput('Dresses')).toEqual({
      ok: true,
      subcategory: '洋裝',
      canonical: true,
    })
  })

  it('accepts a genuinely novel subcategory', () => {
    expect(resolveSubcategoryInput('手工燈籠')).toEqual({
      ok: true,
      subcategory: '手工燈籠',
      canonical: false,
    })
  })

  it('rejects a too-short input', () => {
    expect(resolveSubcategoryInput('襪')).toEqual({ ok: false, reason: 'length' })
  })

  it('rejects a too-long input', () => {
    expect(resolveSubcategoryInput('手工玻璃吹製花瓶器')).toEqual({
      ok: false,
      reason: 'length',
    })
  })

  it('rejects a blocklisted input', () => {
    expect(resolveSubcategoryInput('禮盒組')).toEqual({
      ok: false,
      reason: 'blocklist',
    })
    expect(resolveSubcategoryInput('迷你花瓶')).toEqual({
      ok: false,
      reason: 'blocklist',
    })
  })

  it('trims surrounding whitespace before matching', () => {
    expect(resolveSubcategoryInput('  洋裝  ')).toEqual({
      ok: true,
      subcategory: '洋裝',
      canonical: true,
    })
    expect(resolveSubcategoryInput('  手工燈籠  ')).toEqual({
      ok: true,
      subcategory: '手工燈籠',
      canonical: false,
    })
  })
})

describe('novelSubcategoryRejection', () => {
  it('novelSubcategoryRejection returns null for an acceptable novel subcategory', () => {
    expect(novelSubcategoryRejection('手工燈籠')).toBeNull()
  })

  it('rejects retired composite spellings before the novel-tag escape hatch', () => {
    expect(novelSubcategoryRejection('香氛・蠟燭')).toBe('retired-composite')
    expect(novelSubcategoryRejection('香氛蠟燭')).toBe('retired-composite')
  })

  it('agrees with the heuristics it replaced', () => {
    expect(novelSubcategoryRejection('襪')).toBe('length')
    expect(novelSubcategoryRejection('手工玻璃吹製花瓶器')).toBe('length')
    expect(novelSubcategoryRejection('超值限定組')).toBe('blocklist')
    expect(novelSubcategoryRejection('藍鵲系列襪子')).toBe('blocklist')
  })

  it('measures the band in code points, not UTF-16 units', () => {
    // One emoji: 2 code units, 1 character — must fail the min like '襪' does.
    expect(novelSubcategoryRejection('🧦')).toBe('length')
    expect(resolveSubcategoryInput('🧦')).toEqual({
      ok: false,
      reason: 'length',
    })
    // Nine emoji: 9 characters, over the max.
    expect(novelSubcategoryRejection('🧦🧦🧦🧦🧦🧦🧦🧦🧦')).toBe('length')
    // The Han cases the band was written against are untouched.
    expect(novelSubcategoryRejection('手工燈籠')).toBeNull()
  })
})

describe('applySubcategoryDelta', () => {
  it('removes and dedupes on the ontology matching key, keeping first casing', () => {
    expect(applySubcategoryDelta(['Vegan'], { add: ['vegan'], remove: [] })).toEqual([
      'Vegan',
    ])
    expect(applySubcategoryDelta([], { add: ['Vegan', 'vegan'], remove: [] })).toEqual([
      'Vegan',
    ])
    // A removal typed in a different casing still removes the stored tag.
    expect(applySubcategoryDelta(['Vegan'], { add: [], remove: ['vegan'] })).toEqual([])
  })

  it('preserves order and leaves unrelated subcategories alone', () => {
    expect(
      applySubcategoryDelta(['托特包', '後背包'], { add: ['斜背包'], remove: ['後背包'] }),
    ).toEqual(['托特包', '斜背包'])
  })
})

describe('deriveSubcategoriesEn', () => {
  it('maps vocab matches to canonical EN and falls back to zh for novels', () => {
    expect(deriveSubcategoriesEn(['托特包', '手工燈籠'])).toEqual(['Tote Bags', '手工燈籠'])
  })
  it('returns empty for empty input', () => {
    expect(deriveSubcategoriesEn([])).toEqual([])
  })

  it('lets an ontology hit override a stale stored EN', () => {
    // The DEV-1266 drift case: '後背包' was stored as 'Backpack', not the
    // canonical 'Backpacks'.
    expect(deriveSubcategoriesEn(['後背包'], ['Backpack'])).toEqual(['Backpacks'])
    expect(deriveSubcategoriesEn(['後背包'], ['backpack'])).toEqual(['Backpacks'])
  })

  it('keeps a novel subcategory stored EN, Title Cased', () => {
    // '手工燈籠' misses the ontology, so the stored translation is the best
    // English available and must survive.
    expect(deriveSubcategoriesEn(['手工燈籠'], ['handmade lantern'])).toEqual([
      'Handmade Lantern',
    ])
  })

  it('falls back to the raw zh when a novel subcategory has no stored EN', () => {
    expect(deriveSubcategoriesEn(['手工燈籠'], [])).toEqual(['手工燈籠'])
    expect(deriveSubcategoriesEn(['手工燈籠'], ['  '])).toEqual(['手工燈籠'])
  })

  it('aligns existingEn by index and ignores a shorter stored array', () => {
    expect(
      deriveSubcategoriesEn(['後背包', '手工燈籠'], ['backpack']),
    ).toEqual(['Backpacks', '手工燈籠'])
  })

  it('behaves identically when called with one argument', () => {
    expect(deriveSubcategoriesEn(['後背包', '手工燈籠'])).toEqual([
      'Backpacks',
      '手工燈籠',
    ])
  })
})

describe('planSubcategoryBackfill', () => {
  it('splits subcategories into deterministic matches and llm candidates', () => {
    const plan = planSubcategoryBackfill(['側背包', '口金短夾', '登山背包'])
    expect(plan.matched.map((m) => m.canonicalZh)).toEqual(['斜背包', '後背包'])
    expect(plan.unmatched).toEqual(['口金短夾'])
  })
  it('is idempotent on already-canonical input', () => {
    const plan = planSubcategoryBackfill(['斜背包', '後背包'])
    expect(plan.matched.map((m) => m.canonicalZh)).toEqual(['斜背包', '後背包'])
    expect(plan.unmatched).toEqual([])
  })
})
