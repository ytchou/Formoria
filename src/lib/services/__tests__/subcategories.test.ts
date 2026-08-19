import { beforeEach, describe, it, expect } from 'vitest'
import * as subcategoriesModule from '../subcategories'
import * as ontologyModule from '@/lib/taxonomy/ontology'
import {
  normalizeSubcategories,
  deriveSubcategoriesEn,
  planSubcategoryBackfill,
  resolveSubcategorySelection,
  recordRejectedSubcategoryInput,
  readRejectedSubcategoryInputs,
  clearRejectedSubcategoryInputs,
  setRejectedSubcategorySink,
  applySubcategoryDelta,
  deriveCategoryFromSubcategories,
} from '../subcategories'

beforeEach(() => {
  clearRejectedSubcategoryInputs()
  setRejectedSubcategorySink(null)
})

describe('the closed vocabulary', () => {
  it('novel_subcategory_rejection_is_gone', () => {
    // The free-text escape hatch and the DEV-1361 deny-list are both gone: the
    // vocabulary is closed, so there is no novel branch left to gate and no
    // retired spelling left to keep out of it.
    expect('novelSubcategoryRejection' in subcategoriesModule).toBe(false)
    expect('resolveSubcategoryInput' in subcategoriesModule).toBe(false)
    expect('RETIRED_COMPOSITE_LABELS' in ontologyModule).toBe(false)
    expect('isRetiredCompositeLabel' in ontologyModule).toBe(false)
  })

  it('drops the crossBranch diagnostic — a cross-L1 tag is now expressible, not an anomaly', () => {
    const result = normalizeSubcategories(['backpacks'], [])
    expect(result).not.toHaveProperty('crossBranch')
    expect(result.subcategories).toEqual(['backpacks'])
  })
})

describe('normalizeSubcategories', () => {
  it('resolves labels and aliases to stored slugs', () => {
    const result = normalizeSubcategories(['側背包', '托特包'], ['crossbody', 'tote'])
    expect(result.subcategories).toEqual(['crossbody-bags', 'tote-bags'])
    expect(result.subcategoriesEn).toEqual(['Crossbody Bags', 'Tote Bags'])
  })

  it('is idempotent on slugs it already stores', () => {
    const result = normalizeSubcategories(['crossbody-bags', 'tote-bags'], [])
    expect(result.subcategories).toEqual(['crossbody-bags', 'tote-bags'])
    expect(result.subcategoriesEn).toEqual(['Crossbody Bags', 'Tote Bags'])
  })

  it('collapses SKU variants that map to the same node', () => {
    const result = normalizeSubcategories(
      ['口金零錢包', '口金夾', '登山背包'],
      ['clasp coin purse', 'clasp wallet', 'hiking backpack'],
    )
    expect(result.subcategories).toEqual(['clasp-frame-bags', 'backpacks'])
    expect(result.subcategoriesEn).toEqual(['Clasp-Frame Bags', 'Backpacks'])
  })

  it('rejects a term the vocabulary does not know instead of storing it', () => {
    const result = normalizeSubcategories(['手工燈籠'], ['handmade lantern'])
    expect(result.subcategories).toEqual([])
    expect(result.rejected).toEqual([
      { subcategory: '手工燈籠', reason: 'unknown-term' },
    ])
  })

  it('logs every rejection — the closed vocabulary cannot otherwise report its gaps', () => {
    normalizeSubcategories(['手工燈籠', '藍鵲系列襪子'], [])
    expect(readRejectedSubcategoryInputs().map((entry) => entry.input)).toEqual([
      '手工燈籠',
      '藍鵲系列襪子',
    ])
  })

  it('caps at 5 and keeps the two arrays paired', () => {
    const zh = ['托特包', '後背包', '斜背包', '手提包', '水桶包', '零錢包']
    const result = normalizeSubcategories(zh, [])
    expect(result.subcategories).toHaveLength(5)
    expect(result.subcategoriesEn).toHaveLength(5)
  })

  it('splits an unmatched composite and keeps the halves that resolve', () => {
    const result = normalizeSubcategories(['糖果・糕點'], [])
    expect(result.subcategories).toEqual(['desserts-and-pastries'])
    expect(result.subcategoriesEn).toEqual(['Desserts & Pastries'])
  })

  it('keeps a canonical composite node untouched', () => {
    const result = normalizeSubcategories(['甜點・糕點'], [])
    expect(result.subcategories).toEqual(['desserts-and-pastries'])
  })

  it('resolves a DEV-1361 retired composite through its halves rather than a deny-list', () => {
    // `香氛・蠟燭` was split into atomic nodes; `蠟燭` is one of them and
    // `香氛` is not a node on its own. The deny-list existed only to keep the
    // old spelling out of the novel escape hatch, which no longer exists.
    const result = normalizeSubcategories(['香氛・蠟燭'], [])
    expect(result.subcategories).toEqual(['candles'])
  })

  it('drops an unmatched composite when neither half resolves', () => {
    const result = normalizeSubcategories(['地板・地板材料'], [])
    expect(result.subcategories).toEqual([])
  })

  it('ignores blank entries without logging them as vocabulary gaps', () => {
    const result = normalizeSubcategories(['', '   ', '托特包'], [])
    expect(result.subcategories).toEqual(['tote-bags'])
    expect(result.rejected).toEqual([])
    expect(readRejectedSubcategoryInputs()).toEqual([])
  })
})

describe('resolveSubcategorySelection', () => {
  it('resolves a stored slug', () => {
    expect(resolveSubcategorySelection('dresses')).toMatchObject({
      ok: true,
      slug: 'dresses',
    })
  })

  it('resolves a canonical nameZh, an alias and an English name to the same slug', () => {
    expect(resolveSubcategorySelection('洋裝')).toMatchObject({ ok: true, slug: 'dresses' })
    expect(resolveSubcategorySelection('T恤')).toMatchObject({
      ok: true,
      slug: 'tops-and-tshirts',
    })
    expect(resolveSubcategorySelection('Dresses')).toMatchObject({
      ok: true,
      slug: 'dresses',
    })
  })

  it('trims before matching', () => {
    expect(resolveSubcategorySelection('  洋裝  ')).toMatchObject({
      ok: true,
      slug: 'dresses',
    })
  })

  it('rejects free text, an evicted label and an empty string', () => {
    expect(resolveSubcategorySelection('手工燈籠')).toEqual({
      ok: false,
      reason: 'unknown-term',
    })
    expect(resolveSubcategorySelection('禮盒')).toEqual({
      ok: false,
      reason: 'unknown-term',
    })
    expect(resolveSubcategorySelection('   ')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('the rejected-input log', () => {
  it('records the input, the surface and when it happened', () => {
    recordRejectedSubcategoryInput({ input: '止滑墊', surface: 'correction-dialog' })
    const [entry] = readRejectedSubcategoryInputs()
    expect(entry?.input).toBe('止滑墊')
    expect(entry?.surface).toBe('correction-dialog')
    expect(entry?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('forwards to an installed sink so a surface can persist the gap signal', () => {
    const seen: string[] = []
    setRejectedSubcategorySink((entry) => seen.push(entry.input))
    recordRejectedSubcategoryInput({ input: '樂器', surface: 'admin-review' })
    expect(seen).toEqual(['樂器'])
  })

  it('never lets an unbounded client session grow the buffer without limit', () => {
    for (let index = 0; index < 260; index++) {
      recordRejectedSubcategoryInput({ input: `gap-${index}`, surface: 'test' })
    }
    const entries = readRejectedSubcategoryInputs()
    expect(entries.length).toBeLessThanOrEqual(200)
    // The newest rejections are the ones worth keeping.
    expect(entries.at(-1)?.input).toBe('gap-259')
  })
})

describe('deriveCategoryFromSubcategories', () => {
  it('derives the only L1 represented by the stored slugs', () => {
    expect(deriveCategoryFromSubcategories(['furniture', 'candles'])).toBe('home')
  })

  it('still reads pre-migration labels', () => {
    expect(deriveCategoryFromSubcategories(['家具', '蠟燭'])).toBe('home')
  })

  it('uses the unique winner when the slugs span L1s', () => {
    expect(deriveCategoryFromSubcategories(['casual-shoes', 'dresses', 'furniture'])).toBe(
      'fashion',
    )
  })

  it('leaves tied or entirely unknown sets uncategorized', () => {
    expect(deriveCategoryFromSubcategories(['casual-shoes', 'furniture'])).toBeNull()
    expect(deriveCategoryFromSubcategories(['學步鞋', '機能鞋'])).toBeNull()
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
    expect(applySubcategoryDelta(['Vegan'], { add: [], remove: ['vegan'] })).toEqual([])
  })

  it('preserves order and leaves unrelated slugs alone', () => {
    expect(
      applySubcategoryDelta(['tote-bags', 'backpacks'], {
        add: ['crossbody-bags'],
        remove: ['backpacks'],
      }),
    ).toEqual(['tote-bags', 'crossbody-bags'])
  })
})

describe('deriveSubcategoriesEn', () => {
  it('maps a stored slug to its canonical EN', () => {
    expect(deriveSubcategoriesEn(['tote-bags', 'backpacks'])).toEqual([
      'Tote Bags',
      'Backpacks',
    ])
  })

  it('still maps a pre-migration label', () => {
    expect(deriveSubcategoriesEn(['托特包'])).toEqual(['Tote Bags'])
  })

  it('returns empty for empty input', () => {
    expect(deriveSubcategoriesEn([])).toEqual([])
  })

  it('lets a vocabulary hit override a stale stored EN', () => {
    // The DEV-1266 drift case: '後背包' was stored as 'Backpack'.
    expect(deriveSubcategoriesEn(['backpacks'], ['Backpack'])).toEqual(['Backpacks'])
    expect(deriveSubcategoriesEn(['後背包'], ['backpack'])).toEqual(['Backpacks'])
  })

  it('keeps a value the vocabulary does not know, Title Cased from its stored EN', () => {
    expect(deriveSubcategoriesEn(['手工燈籠'], ['handmade lantern'])).toEqual([
      'Handmade Lantern',
    ])
    expect(deriveSubcategoriesEn(['手工燈籠'], [])).toEqual(['手工燈籠'])
  })

  it('aligns existingEn by index and ignores a shorter stored array', () => {
    expect(deriveSubcategoriesEn(['backpacks', '手工燈籠'], ['backpack'])).toEqual([
      'Backpacks',
      '手工燈籠',
    ])
  })
})

describe('planSubcategoryBackfill', () => {
  it('splits subcategories into deterministic matches and llm candidates', () => {
    const plan = planSubcategoryBackfill(['側背包', '口金短夾', '登山背包'])
    expect(plan.matched.map((m) => m.slug)).toEqual(['crossbody-bags', 'backpacks'])
    expect(plan.unmatched).toEqual(['口金短夾'])
  })

  it('is idempotent on already-canonical input', () => {
    const plan = planSubcategoryBackfill(['斜背包', '後背包'])
    expect(plan.matched.map((m) => m.canonicalZh)).toEqual(['斜背包', '後背包'])
    expect(plan.unmatched).toEqual([])
  })
})
