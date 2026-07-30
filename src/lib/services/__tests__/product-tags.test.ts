import { describe, it, expect } from 'vitest'
import {
  normalizeProductTags,
  deriveProductTagsEn,
  planTagBackfill,
  novelTagRejection,
  resolveProductTagInput,
  applyTagDelta,
  deriveProductTypeFromTags,
} from '../product-tags'

describe('normalizeProductTags', () => {
  it('replaces vocab matches with canonical zh/en pairs', () => {
    const result = normalizeProductTags(['側背包', '托特包'], ['crossbody', 'tote'])
    expect(result.tags).toEqual(['斜背包', '托特包'])
    expect(result.tagsEn).toEqual(['Crossbody Bags', 'Tote Bags'])
  })

  it('collapses SKU variants that map to the same canonical', () => {
    const result = normalizeProductTags(
      ['口金零錢包', '口金夾', '登山背包'],
      ['clasp coin purse', 'clasp wallet', 'hiking backpack'],
    )
    expect(result.tags).toEqual(['口金包', '後背包'])
    expect(result.tagsEn).toEqual(['Clasp-Frame Bags', 'Backpacks'])
  })

  it('keeps heuristic-clean novel tags with their EN, zh fallback when EN missing', () => {
    const result = normalizeProductTags(['手工燈籠'], [])
    expect(result.tags).toEqual(['手工燈籠'])
    expect(result.tagsEn).toEqual(['手工燈籠'])
  })

  it('title-cases a novel tag EN so it matches ontology casing on cards', () => {
    const result = normalizeProductTags(
      ['手工燈籠', '雨鞋', '臉部防曬'],
      ['handmade lantern', 'rain boots', 'facial sunscreen'],
    )
    expect(result.tagsEn).toEqual(['Handmade Lantern', 'Rain Boots', 'Facial Sunscreen'])
  })

  it('leaves an already-capitalized novel tag EN and its inner casing alone', () => {
    const result = normalizeProductTags(
      ['手工燈籠', '無線充電盤'],
      ['Handmade Lantern', 'USB-C charging pad'],
    )
    expect(result.tagsEn).toEqual(['Handmade Lantern', 'USB-C Charging Pad'])
  })

  it('drops blocklisted and out-of-band novel tags, recording rejections', () => {
    const result = normalizeProductTags(
      ['藍鵲系列襪子', '超值限定組', '襪'],
      ['bluebird series socks', 'limited set', 'sock'],
    )
    expect(result.tags).toEqual([])
    expect(result.rejected.map((r) => r.tag)).toEqual(['藍鵲系列襪子', '超值限定組', '襪'])
  })

  it('caps at 5 and keeps arrays paired', () => {
    const zh = ['托特包', '後背包', '斜背包', '手提包', '水桶包', '零錢包']
    const result = normalizeProductTags(zh, [])
    expect(result.tags).toHaveLength(5)
    expect(result.tagsEn).toHaveLength(5)
  })

  it('flags cross-branch picks when brandCategory provided', () => {
    const result = normalizeProductTags(['手工皂'], [], 'fashion')
    expect(result.crossBranch).toEqual(['手工皂'])
  })
})

describe('deriveProductTypeFromTags', () => {
  it('derives the only ontology category represented by accepted tags', () => {
    expect(deriveProductTypeFromTags(['家具', '地板材料', '天花板材料'])).toBe('home')
  })

  it('uses the unique category winner when recognized tags span categories', () => {
    expect(deriveProductTypeFromTags(['休閒鞋', '洋裝', '家具'])).toBe('fashion')
  })

  it('leaves tied or entirely novel tag sets uncategorized', () => {
    expect(deriveProductTypeFromTags(['休閒鞋', '家具'])).toBeNull()
    expect(deriveProductTypeFromTags(['學步鞋', '機能鞋'])).toBeNull()
  })
})

describe('resolveProductTagInput', () => {
  it('resolves an exact canonical nameZh to itself', () => {
    expect(resolveProductTagInput('洋裝')).toEqual({
      ok: true,
      tag: '洋裝',
      canonical: true,
    })
  })

  it('canonicalizes a known alias to its nameZh', () => {
    expect(resolveProductTagInput('T恤')).toEqual({
      ok: true,
      tag: '上衣・T恤',
      canonical: true,
    })
  })

  it('canonicalizes an English name to its nameZh', () => {
    expect(resolveProductTagInput('Dresses')).toEqual({
      ok: true,
      tag: '洋裝',
      canonical: true,
    })
  })

  it('accepts a genuinely novel tag', () => {
    expect(resolveProductTagInput('手工燈籠')).toEqual({
      ok: true,
      tag: '手工燈籠',
      canonical: false,
    })
  })

  it('rejects a too-short input', () => {
    expect(resolveProductTagInput('襪')).toEqual({ ok: false, reason: 'length' })
  })

  it('rejects a too-long input', () => {
    expect(resolveProductTagInput('手工玻璃吹製花瓶器')).toEqual({
      ok: false,
      reason: 'length',
    })
  })

  it('rejects a blocklisted input', () => {
    expect(resolveProductTagInput('禮盒組')).toEqual({
      ok: false,
      reason: 'blocklist',
    })
    expect(resolveProductTagInput('迷你花瓶')).toEqual({
      ok: false,
      reason: 'blocklist',
    })
  })

  it('trims surrounding whitespace before matching', () => {
    expect(resolveProductTagInput('  洋裝  ')).toEqual({
      ok: true,
      tag: '洋裝',
      canonical: true,
    })
    expect(resolveProductTagInput('  手工燈籠  ')).toEqual({
      ok: true,
      tag: '手工燈籠',
      canonical: false,
    })
  })
})

describe('novelTagRejection', () => {
  it('novelTagRejection returns null for an acceptable novel tag', () => {
    expect(novelTagRejection('手工燈籠')).toBeNull()
  })

  it('agrees with the heuristics it replaced', () => {
    expect(novelTagRejection('襪')).toBe('length')
    expect(novelTagRejection('手工玻璃吹製花瓶器')).toBe('length')
    expect(novelTagRejection('超值限定組')).toBe('blocklist')
    expect(novelTagRejection('藍鵲系列襪子')).toBe('blocklist')
  })

  it('measures the band in code points, not UTF-16 units', () => {
    // One emoji: 2 code units, 1 character — must fail the min like '襪' does.
    expect(novelTagRejection('🧦')).toBe('length')
    expect(resolveProductTagInput('🧦')).toEqual({
      ok: false,
      reason: 'length',
    })
    // Nine emoji: 9 characters, over the max.
    expect(novelTagRejection('🧦🧦🧦🧦🧦🧦🧦🧦🧦')).toBe('length')
    // The Han cases the band was written against are untouched.
    expect(novelTagRejection('手工燈籠')).toBeNull()
  })
})

describe('applyTagDelta', () => {
  it('removes and dedupes on the ontology matching key, keeping first casing', () => {
    expect(applyTagDelta(['Vegan'], { add: ['vegan'], remove: [] })).toEqual([
      'Vegan',
    ])
    expect(applyTagDelta([], { add: ['Vegan', 'vegan'], remove: [] })).toEqual([
      'Vegan',
    ])
    // A removal typed in a different casing still removes the stored tag.
    expect(applyTagDelta(['Vegan'], { add: [], remove: ['vegan'] })).toEqual([])
  })

  it('preserves order and leaves unrelated tags alone', () => {
    expect(
      applyTagDelta(['托特包', '後背包'], { add: ['斜背包'], remove: ['後背包'] }),
    ).toEqual(['托特包', '斜背包'])
  })
})

describe('deriveProductTagsEn', () => {
  it('maps vocab matches to canonical EN and falls back to zh for novels', () => {
    expect(deriveProductTagsEn(['托特包', '手工燈籠'])).toEqual(['Tote Bags', '手工燈籠'])
  })
  it('returns empty for empty input', () => {
    expect(deriveProductTagsEn([])).toEqual([])
  })

  it('lets an ontology hit override a stale stored EN', () => {
    // The DEV-1266 drift case: '後背包' was stored as 'Backpack', not the
    // canonical 'Backpacks'.
    expect(deriveProductTagsEn(['後背包'], ['Backpack'])).toEqual(['Backpacks'])
    expect(deriveProductTagsEn(['後背包'], ['backpack'])).toEqual(['Backpacks'])
  })

  it('keeps a novel tag stored EN, Title Cased', () => {
    // '手工燈籠' misses the ontology, so the stored translation is the best
    // English available and must survive.
    expect(deriveProductTagsEn(['手工燈籠'], ['handmade lantern'])).toEqual([
      'Handmade Lantern',
    ])
  })

  it('falls back to the raw zh when a novel tag has no stored EN', () => {
    expect(deriveProductTagsEn(['手工燈籠'], [])).toEqual(['手工燈籠'])
    expect(deriveProductTagsEn(['手工燈籠'], ['  '])).toEqual(['手工燈籠'])
  })

  it('aligns existingEn by index and ignores a shorter stored array', () => {
    expect(
      deriveProductTagsEn(['後背包', '手工燈籠'], ['backpack']),
    ).toEqual(['Backpacks', '手工燈籠'])
  })

  it('behaves identically when called with one argument', () => {
    expect(deriveProductTagsEn(['後背包', '手工燈籠'])).toEqual([
      'Backpacks',
      '手工燈籠',
    ])
  })
})

describe('planTagBackfill', () => {
  it('splits tags into deterministic matches and llm candidates', () => {
    const plan = planTagBackfill(['側背包', '口金短夾', '登山背包'])
    expect(plan.matched.map((m) => m.canonicalZh)).toEqual(['斜背包', '後背包'])
    expect(plan.unmatched).toEqual(['口金短夾'])
  })
  it('is idempotent on already-canonical input', () => {
    const plan = planTagBackfill(['斜背包', '後背包'])
    expect(plan.matched.map((m) => m.canonicalZh)).toEqual(['斜背包', '後背包'])
    expect(plan.unmatched).toEqual([])
  })
})
