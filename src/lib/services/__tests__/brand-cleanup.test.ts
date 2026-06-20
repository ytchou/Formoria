import { describe, expect, it } from 'vitest'
import { cleanBrandName, detectNonBrand, normalizeSlug } from '../brand-cleanup'

describe('cleanBrandName', () => {
  it('leaves already clean names unchanged', () => {
    expect(cleanBrandName('AROMASE 艾瑪絲')).toEqual({
      originalName: 'AROMASE 艾瑪絲',
      cleanedName: 'AROMASE 艾瑪絲',
      changed: false,
      patternsMatched: [],
      confidence: 'high',
    })
  })

  it('returns metadata for changed names', () => {
    const result = cleanBrandName('梨大爺🥑')

    expect(result.originalName).toBe('梨大爺🥑')
    expect(result.changed).toBe(true)
    expect(result.patternsMatched).toContain('emoji')
    expect(result.confidence).toBe('high')
  })

  it('keeps the original value when cleanup would empty the name', () => {
    expect(cleanBrandName('🥑🌤️')).toMatchObject({
      cleanedName: '🥑🌤️',
      changed: false,
      confidence: 'low',
    })
  })

  it.each([
    ['梨大爺🥑', '梨大爺'],
    ['颳風下雨，穿它就對！😉', '颳風下雨，穿它就對！'],
  ])('removes emojis from %s', (input, expected) => {
    expect(cleanBrandName(input).cleanedName).toBe(expected)
  })

  it.each([
    ['◜ ◌ 綠洲販賣所 Oasis Emporium ◌◜', '綠洲販賣所 Oasis Emporium'],
    ['☼ 椰子派', '椰子派'],
  ])('removes decorative unicode from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('decorative-unicode')
  })

  it.each([
    ['𝓑𝓾𝓲𝓵𝓭.𝓛𝓲𝓰𝓱𝓽 𝓬𝓪𝓷𝓭𝓵𝓮', 'Build.Light Candle'],
    ['𝟒 𝐍𝐮𝐭𝐬', '4 Nuts'],
    ['𝒄𝒐𝒄𝒐𝒏𝒖𝒕 𝒑𝒊𝒆', 'Coconut Pie'],
  ])('normalizes stylized text in %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('stylized-text')
  })

  it.each([
    ['【 1002 】', '1002'],
    ['【PS BUBU Dog&Cat】口碑第一 萬人好評 頂級毛孩保健', 'PS BUBU Dog&Cat'],
  ])('removes bracket noise from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('bracket-noise')
  })

  it.each([
    ['Change Tone 襪子專賣店┃100%台灣設計製造', 'Change Tone'],
    ['COLORSMITH 台灣原創品包包品牌', 'COLORSMITH'],
    ['DKGP 東客集 MIT 好襪專賣店', 'DKGP 東客集'],
    ['JLab 台灣獨家代理', 'JLab'],
  ])('removes marketing suffixes from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('marketing-suffix')
  })

  it.each([
    ['A.MOUR 經典手工鞋', 'A.MOUR'],
    ['2angels 質感矽膠嬰幼餐具', '2angels'],
    ['Fartech翻頁鐘', 'Fartech'],
    ['Aquamax 面膜', 'Aquamax'],
  ])('removes product descriptors from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('product-descriptor')
  })

  it.each([
    ['ESCURA 自然 X 機能服飾', 'ESCURA'],
    ['404Oligo  你的好菌優化師', '404Oligo'],
    ['AROMASE艾瑪絲 頭皮療癒永續品牌', 'AROMASE 艾瑪絲'],
  ])('removes tagline text from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('tagline-separator')
  })

  it('collapses single-character decorative spacing', () => {
    const result = cleanBrandName('S Y D N N I')

    expect(result.cleanedName).toBe('SYDNNI')
    expect(result.patternsMatched).toContain('decorative-spacing')
  })

  it.each([
    ['☼ 椰子派•𝒄𝒐𝒄𝒐𝒏𝒖𝒕 𝒑𝒊𝒆', '椰子派 Coconut Pie'],
    ['*𝓑𝓾𝓲𝓵𝓭.𝓛𝓲𝓰𝓱𝓽 𝓬𝓪𝓷𝓭𝓵𝓮*', 'Build.Light Candle'],
    ['BoingBoing 故事鞋與童畫包', 'BoingBoing'],
    ['Bonjour女人愛買鞋', 'Bonjour'],
    ['FuSoap 台南手工皂', 'FuSoap'],
    ['Dasuit大適坐墊', 'Dasuit 大適'],
  ])('handles combined cleanup for %s', (input, expected) => {
    expect(cleanBrandName(input).cleanedName).toBe(expected)
  })
})

describe('detectNonBrand', () => {
  it('does not flag normal brands', () => {
    expect(
      detectNonBrand({ name: "O'right 歐萊德", description: null, purchaseWebsite: null })
    ).toMatchObject({ isNonBrand: false, reason: null, confidence: 'high' })
  })

  it.each([
    'JLab 台灣獨家代理',
    '某某經銷商',
    '批發大王',
    '娃力小動物認養中心',
    '台灣地方創生基金會',
    '某某協會',
    '社團法人某某',
    '某某鄉公所',
    '某某區公所',
    '首頁',
    '關於我們',
  ])('flags non-brand names: %s', (name) => {
    const result = detectNonBrand({ name, description: null, purchaseWebsite: null })

    expect(result.isNonBrand).toBe(true)
    expect(result.reason).toEqual(expect.any(String))
    expect(result.confidence).toBe('high')
  })

  it('does not flag keywords that appear only in the description', () => {
    expect(
      detectNonBrand({
        name: "O'right 歐萊德",
        description: '我們與基金會合作推廣永續理念',
        purchaseWebsite: null,
      })
    ).toMatchObject({ isNonBrand: false, reason: null })
  })
})

describe('normalizeSlug', () => {
  it.each([
    ['aromase', null, { newSlug: null, source: 'unchanged' }],
    ['慢慢挑', null, { newSlug: null, source: 'unchanged' }],
    ['慢慢挑', 'Man Man Tiao', { newSlug: 'man-man-tiao', source: 'scraped-english-name' }],
    ['採花女孩', '採花女孩', { newSlug: null, source: 'unchanged' }],
    ['植茁', 'ZHI GROW', { newSlug: 'zhi-grow', source: 'scraped-english-name' }],
    ['oright', "O'Right", { newSlug: null, source: 'unchanged' }],
  ] as const)('normalizes %s with scraped name %s', (slug, scrapedBrandName, expected) => {
    expect(normalizeSlug(slug, scrapedBrandName)).toEqual(expected)
  })
})
