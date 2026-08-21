import { describe, expect, it } from 'vitest'
import {
  EVICTED_LABELS,
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
  OUT_OF_FRAME_LABELS,
  isCompositeSubcategory,
  isKnownSubcategoryTerm,
  matchSubcategory,
  materialBySlug,
  normalizeSubcategoryKey,
  resolveSubcategorySlugs,
  subcategoryBySlug,
  subcategoryLabel,
  deriveCategoryLabel,
  categoryTint,
} from '../ontology'
import corpusLabels from './fixtures/corpus-labels.json'

describe('L1_CATEGORIES', () => {
  // The presence and type of slug/name/nameZh/tint is a tsc concern, but the
  // SHAPE of tint is not: it is a bare string that ships straight into CSS, so
  // a malformed value renders no colour and raises nowhere.
  it('every category tint is a renderable oklch colour', () => {
    for (const cat of L1_CATEGORIES) {
      expect(cat.tint, `${cat.slug} tint`).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/)
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
    expect(slugs).toContain('stationery')
    expect(slugs).toContain('tech')
    expect(slugs).toContain('outdoor')
    expect(slugs).toContain('fitness')
    expect(slugs).toContain('kids')
    expect(slugs).toContain('pets')
  })

  it('does not contain old sub-category slugs', () => {
    const slugs = L1_CATEGORIES.map(c => c.slug)
    expect(slugs).not.toContain('clothing')
    expect(slugs).not.toContain('footwear')
    expect(slugs).not.toContain('others')
    expect(slugs).not.toContain('baby-kids')
    expect(slugs).not.toContain('kids-pets')
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
      // DEV-1510 widened four of these alias lists. The pin stays exact: it is
      // what proves the DEV-1361 atomic replacements still own their spellings
      // exclusively after the residual table folded in.
      'home-fragrance': { nameZh: '居家香氛', category: 'home', aliases: ['線香', '擴香', '香氛袋', '擴香瓶', '盤香', '香粉', '香道具'] },
      candles: { nameZh: '蠟燭', category: 'home', aliases: [] },
      keychains: { nameZh: '鑰匙圈', category: 'bags-accessories', aliases: [] },
      charms: { nameZh: '吊飾', category: 'bags-accessories', aliases: [] },
      'storage-pouches': { nameZh: '收納包', category: 'bags-accessories', aliases: ['旅行收納包', '束口袋'] },
      'cosmetic-bags': { nameZh: '化妝包', category: 'bags-accessories', aliases: [] },
      'tea-bags': { nameZh: '茶包', category: 'food-drink', aliases: [] },
      'tea-drinks': { nameZh: '茶飲', category: 'food-drink', aliases: ['冷泡茶'] },
      toys: { nameZh: '玩具', category: 'kids', aliases: ['布偶', '益智玩具'] },
      'learning-aids': { nameZh: '教具', category: 'kids', aliases: [] },
      // DEV-1507 folded `dried-flowers-and-floral-design` in here, so the pin
      // now carries its four spellings. Exactness is the point: the absorbed
      // aliases must land on this node and nowhere else.
      'floral-arrangements': { nameZh: '花藝', category: 'home', aliases: ['乾燥花花藝設計', '乾燥花', '花藝設計', '永生花'] },
      plants: { nameZh: '植栽', category: 'home', aliases: ['盆栽', '多肉園藝'] },
      towels: { nameZh: '毛巾', category: 'home', aliases: ['浴巾'] },
      'home-textiles': { nameZh: '居家織品', category: 'home', aliases: ['抱枕', '毯', '毛毯'] },
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

describe('isKnownSubcategoryTerm', () => {
  it('answers on both bases: the stored slug and the label', () => {
    expect(isKnownSubcategoryTerm('tote-bags')).toBe(true)
    expect(isKnownSubcategoryTerm('托特包')).toBe(true)
    expect(isKnownSubcategoryTerm('帆布包')).toBe(true)
    expect(isKnownSubcategoryTerm('口金短夾')).toBe(false)
    expect(isKnownSubcategoryTerm('')).toBe(false)
  })

  it('ignores surrounding whitespace, on the slug basis too', () => {
    // One closed vocabulary, one membership rule. `matchSubcategory` trims
    // through `normalizeSubcategoryKey` but `subcategoryBySlug` is an exact map
    // hit, so an untrimmed predicate answered differently depending on whether
    // the calling schema happened to `.trim()` its elements first —
    // `adminReviewSchema` does, `brandWizardBasicInfoSchema` does not.
    // The agreement with `resolveSubcategorySelection` is asserted in
    // `services/__tests__/subcategories.test.ts`, which can import both.
    for (const value of [' tote-bags', 'tote-bags ', '\ttote-bags\n', ' 托特包 ']) {
      expect(isKnownSubcategoryTerm(value), `${JSON.stringify(value)} is known`).toBe(true)
    }

    // Trimming is not laxity: interior characters still have to match.
    expect(isKnownSubcategoryTerm('tote bags')).toBe(true) // the EN name
    expect(isKnownSubcategoryTerm('tote--bags')).toBe(false)
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
    // Inlined by DEV-1510: the deny-list export is gone with the novel-subcategory
    // escape hatch it guarded, but the invariant is not — none of these DEV-1361
    // spellings may return as an alias of the atomic nodes that replaced them.
    const retiredCompositeLabels = [
      '香氛・蠟燭',
      '鑰匙圈・吊飾',
      '收納包・化妝包',
      '茶包・茶飲',
      '玩具・教具',
      '花藝・植栽',
      '毛巾・生活織品',
      '手機袋・手機背帶',
    ]
    for (const label of retiredCompositeLabels) {
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

// ---------------------------------------------------------------------------
// DEV-1510 — the closed vocabulary
// ---------------------------------------------------------------------------

const NEW_NODES_2026_08_19: Record<string, string> = {
  umbrellas: 'bags-accessories',
  gloves: 'bags-accessories',
  'cufflinks-and-tie-clips': 'jewelry',
  'feminine-care': 'beauty',
  'beauty-tools': 'beauty',
  'pest-control': 'home',
  'figurines-and-plush': 'home',
  bookmarks: 'stationery',
  'craft-kits-and-supplies': 'stationery',
}

describe('DEV-1510 closed vocabulary', () => {
  it('kids_and_pets_are_separate_l1s', () => {
    const slugs = L1_CATEGORIES.map(category => category.slug)
    expect(slugs).toContain('kids')
    expect(slugs).toContain('pets')
    expect(slugs).not.toContain('kids-pets')

    expect(L2_SUBCATEGORIES.filter(sub => sub.category === 'kids')).toHaveLength(10)
    expect(L2_SUBCATEGORIES.filter(sub => sub.category === 'pets')).toHaveLength(7)
    expect(L2_SUBCATEGORIES.filter(sub => (sub.category as string) === 'kids-pets')).toHaveLength(0)

    // The split is by audience, not by spelling: every pet node moved and no
    // baby node followed it.
    for (const sub of L2_SUBCATEGORIES.filter(s => s.category === 'pets')) {
      expect(sub.slug.startsWith('pet-'), `${sub.slug} is not a pet node`).toBe(true)
    }
  })

  it('crafts_is_retired', () => {
    // 工藝 named a technique, not a product kind, so the L1 and the ten
    // technique nodes under it leave together (DEV-1507). The material axis
    // already carries what the object is made of.
    expect(L1_CATEGORIES.map(category => category.slug)).not.toContain('crafts')
    expect(L2_SUBCATEGORIES.filter(sub => (sub.category as string) === 'crafts')).toHaveLength(0)

    for (const slug of [
      'ceramics',
      'woodcraft',
      'metalwork',
      'bamboo-craft',
      'glass-art',
      'natural-dyeing',
      'leather-craft',
      'embroidery',
      'needle-felting',
      'weaving-and-crochet',
      'illustration-and-art',
      'dried-flowers-and-floral-design',
    ]) {
      expect(subcategoryBySlug(slug), `${slug} must be gone`).toBeNull()
    }
  })

  it('wall_art_inherits_the_illustration_aliases', () => {
    // 插畫・畫作 carries 53 recorded tag-uses — the largest single label in the
    // retired bucket — so the relocation has to keep every spelling resolving.
    expect(matchSubcategory('插畫・畫作')?.slug).toBe('wall-art')
    expect(subcategoryBySlug('wall-art')).toMatchObject({
      nameZh: '掛畫・畫作',
      category: 'home',
      aliases: ['插畫畫作', '插畫', '畫作', '水彩', '版畫', '無框畫'],
    })

    // Still distinct from home-decor's 裝飾畫: an ornament is not a hung picture.
    expect(matchSubcategory('裝飾畫')?.slug).toBe('home-decor')
  })

  it('floral_arrangements_absorbs_the_dried_flower_spellings', () => {
    // A dried bouquet is a kind of 花藝, so the node folds in rather than dying
    // with the L1 that happened to hold it.
    expect(matchSubcategory('乾燥花・花藝設計')?.slug).toBe('floral-arrangements')
    for (const spelling of ['乾燥花花藝設計', '乾燥花', '花藝設計', '永生花']) {
      expect(matchSubcategory(spelling)?.slug, spelling).toBe('floral-arrangements')
    }
    expect(subcategoryBySlug('floral-arrangements')?.category).toBe('home')
  })

  it('materials_vocabulary_is_the_twelve_agreed_slugs', () => {
    expect(MATERIALS.map(material => material.slug)).toEqual([
      'ceramic',
      'wood',
      'textile',
      'glass',
      'metal',
      'bamboo',
      'wool',
      'leather',
      'paper',
      'stone',
      'rattan',
      'lacquer',
    ])
    expect(new Set(MATERIALS.map(material => material.slug)).size).toBe(12)
  })

  it('material_slugs_are_ascii_kebab_case', () => {
    // The slug is the URL token `?material=` carries and the value the CHECK
    // constraint stores, so it has to survive a round trip through a query
    // string unescaped. The exact-list test above pins today's twelve; this
    // one states the rule any thirteenth would have to meet.
    for (const material of MATERIALS) {
      expect(material.slug, `${material.nameZh} slug`).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('every_material_carries_both_labels', () => {
    // The slug is what `brands.material` stores and what `?material=` carries;
    // both labels are display-only, so a blank one renders an empty rail chip
    // rather than raising anywhere.
    for (const material of MATERIALS) {
      expect(material.nameZh, `${material.slug} nameZh`).toBeTruthy()
      expect(material.nameEn, `${material.slug} nameEn`).toBeTruthy()
    }

    expect(MATERIALS.map(material => material.nameZh)).toEqual([
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
    ])
  })

  it('material_slugs_do_not_collide_with_l2', () => {
    // The material axis is a separate vocabulary from the use axis, and it is
    // the IDENTIFIERS that have to stay disjoint: a material slug that is also
    // an L2 slug, or a material zh-TW label spelled like an L2 slug, would make
    // a `?material=` value and a `?sub=` value ambiguous.
    //
    // Labels are allowed to overlap and the rule does not depend on whether any
    // currently do: 陶瓷 is `MATERIALS[0].nameZh` and was an L2 alias until
    // DEV-1507 retired the node that held it. Either way it is benign — the two
    // axes are separate URL params, and `material` resolves by slug only, so
    // `?material=陶瓷` is dropped rather than read as an L2.
    const l2Slugs = new Set(L2_SUBCATEGORIES.map(sub => sub.slug))
    for (const material of MATERIALS) {
      expect(l2Slugs.has(material.slug), `${material.slug} is also an L2 slug`).toBe(false)
      expect(l2Slugs.has(material.nameZh), `${material.nameZh} is also an L2 slug`).toBe(false)
    }
  })

  it('material_by_slug_resolves_and_rejects', () => {
    expect(materialBySlug('ceramic')).toEqual({
      slug: 'ceramic',
      nameZh: '陶瓷',
      nameEn: 'Ceramic',
    })

    // The zh-TW label is display-only now: it resolves nothing, so a stored zh
    // term left behind by a missed backfill fails loudly instead of filtering.
    expect(materialBySlug('陶瓷')).toBeNull()
  })

  it('every_corpus_label_resolves', () => {
    // Reads a committed fixture, never `docs/reports/` — `docs/` is gitignored
    // and does not exist in CI, so a test that read the corpus CSV would pass
    // locally and vacuously skip on the runner.
    const evicted = new Set(EVICTED_LABELS.map(normalizeSubcategoryKey))
    const outOfFrame = new Set(OUT_OF_FRAME_LABELS.map(normalizeSubcategoryKey))

    expect(corpusLabels.tagUses).toBe(2446)
    expect(corpusLabels.labels).toHaveLength(corpusLabels.distinctLabels)

    const unresolved: string[] = []
    for (const { label, tagUses } of corpusLabels.labels) {
      const key = normalizeSubcategoryKey(label)
      const resolved =
        matchSubcategory(label) !== null || evicted.has(key) || outOfFrame.has(key)
      if (!resolved) unresolved.push(`${label} (${tagUses})`)
    }

    // The backfill fails on anything outside this closed set, so an unresolved
    // label here is a production row that would abort the migration.
    expect(unresolved, `unresolved labels: ${unresolved.join(', ')}`).toEqual([])
  })

  it('evicted_labels_are_not_aliases', () => {
    // Aliases and evictions are different sets. Adding 食品禮盒 as an alias
    // resurrects the label the closure exists to remove, and the L2 screen
    // above reads `nameZh` only — nothing else would catch it.
    const aliases = new Map<string, string>()
    for (const sub of L2_SUBCATEGORIES) {
      for (const alias of sub.aliases) aliases.set(normalizeSubcategoryKey(alias), sub.slug)
      aliases.set(normalizeSubcategoryKey(sub.nameZh), sub.slug)
    }

    const resurrected: string[] = []
    for (const label of EVICTED_LABELS) {
      const owner = aliases.get(normalizeSubcategoryKey(label))
      if (owner) resurrected.push(`${label} -> ${owner}`)
    }
    expect(resurrected, `evicted labels resurrected as aliases: ${resurrected.join(', ')}`).toEqual([])

    for (const label of EVICTED_LABELS) {
      expect(matchSubcategory(label), `${label} must not resolve`).toBeNull()
    }
    for (const label of OUT_OF_FRAME_LABELS) {
      expect(matchSubcategory(label), `${label} must not resolve`).toBeNull()
    }

    // The two sets are disjoint: an evicted label loses a tag, an out-of-frame
    // label loses the brand.
    const evicted = new Set<string>(EVICTED_LABELS)
    expect(OUT_OF_FRAME_LABELS.filter(label => evicted.has(label))).toEqual([])
  })

  it('new_nodes_pass_the_admission_rule', () => {
    const disqualifyingTokens = ['禮盒', '伴手禮', '彌月', '客製化', '體驗課程', '課程', '服務']

    for (const [slug, parent] of Object.entries(NEW_NODES_2026_08_19)) {
      const node = subcategoryBySlug(slug)
      expect(node, `${slug} should exist`).not.toBeNull()
      expect(node!.category, `${slug} parent`).toBe(parent)
      expect(node!.nameZh).toBeTruthy()
      expect(node!.nameEn).toBeTruthy()

      for (const token of disqualifyingTokens) {
        expect(
          node!.nameZh.includes(token),
          `${slug} (${node!.nameZh}) names a ${token}, which is not a product kind`,
        ).toBe(false)
      }
    }

    expect(Object.keys(NEW_NODES_2026_08_19)).toHaveLength(9)
  })

  it('distinct_neighbours_preserved', () => {
    // 防蚊 is protective-sprays', not pest-control's — the two sit one concept
    // apart and the overlap is a single character.
    expect(matchSubcategory('防蚊')?.slug).toBe('protective-sprays')
    expect(subcategoryBySlug('pest-control')?.aliases).not.toContain('防蚊')

    // 雨衣 is pet-apparel's, not umbrellas'.
    expect(matchSubcategory('雨衣')?.slug).toBe('pet-apparel')
    expect(subcategoryBySlug('umbrellas')?.aliases).not.toContain('雨衣')

    // figurines-and-plush is not toys: a display figure is decor a collector
    // buys for themselves, and it lives under home, not kids.
    expect(subcategoryBySlug('figurines-and-plush')?.category).toBe('home')
    expect(subcategoryBySlug('toys')?.category).toBe('kids')
    expect(matchSubcategory('公仔')?.slug).toBe('figurines-and-plush')
    expect(matchSubcategory('布偶')?.slug).toBe('toys')

    // 手帕 goes to scarves-and-shawls, 杯墊 to tableware, 雨靴 to boots —
    // aliased rather than admitted as nodes.
    expect(matchSubcategory('手帕')?.slug).toBe('scarves-and-shawls')
    expect(matchSubcategory('杯墊')?.slug).toBe('tableware')
    expect(matchSubcategory('雨靴')?.slug).toBe('boots')

    // The earphones zero was an alias gap, not a node gap.
    for (const spelling of ['真無線藍牙耳機', '降噪耳機', '兒童耳機', '開放式耳罩耳機']) {
      expect(matchSubcategory(spelling)?.slug, spelling).toBe('earphones-and-headphones')
    }
  })
})
