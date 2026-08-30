import { describe, expect, it } from 'vitest'
import {
  canonicalizeBilingualBrandName,
  cleanBrandName,
  isTaiwanFirstBilingualBrandName,
} from '../brand-cleanup'

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
    ['MOUR客製化', 'MOUR'],
    ['Fartech.com.tw', 'Fartech'],
    ['Handmade限量手作', 'Handmade'],
  ])('removes product descriptors from %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('product-descriptor')
  })

  it.each([
    ['Change Tone 襪子專賣店┃100%台灣設計製造', 'Change Tone'],
    ['首頁 - 小朱甜點', '小朱甜點'],
    ['小朱甜點 | 官方網站', '小朱甜點'],
  ])('keeps the first non-boilerplate separator segment of %s', (input, expected) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(expected)
    expect(result.patternsMatched).toContain('tagline-separator')
  })

  // A Latin head followed by a CJK run is the same string shape whether the run is a tagline
  // (`BoingBoing 故事鞋與童畫包`) or half the registered name (`UNIGAZE 慢火金工創作室`), and
  // no regex can tell them apart. Without a separator to go on, the name is left alone for the
  // downstream `names` arbitration phase rather than guessed at (DEV-1321).
  it.each([
    ['UNIGAZE 慢火金工創作室'],
    ['暮苒甜點工作室'],
    ['藺草工坊'],
    ['品牌工作室'],
    ['02 編織工作室'],
    ['BoingBoing 故事鞋與童畫包'],
    ['ESCURA 自然 X 機能服飾'],
    // Lowercase and mixed casing are brand identity, not junk — never re-cased.
    ['qn dessert'],
    ['一屋 1woof'],
  ])('leaves ambiguous name %s for the arbiter', (input) => {
    const result = cleanBrandName(input)

    expect(result.cleanedName).toBe(input)
    expect(result.changed).toBe(false)
  })

  it.each([
    ['404Oligo  你的好菌優化師', '404Oligo 你的好菌優化師'],
    ['AROMASE艾瑪絲 頭皮療癒永續品牌', 'AROMASE 艾瑪絲 頭皮療癒永續品牌'],
  ])('normalizes spacing without truncating %s', (input, expected) => {
    expect(cleanBrandName(input).cleanedName).toBe(expected)
  })

  it('collapses single-character decorative spacing', () => {
    const result = cleanBrandName('S Y D N N I')

    expect(result.cleanedName).toBe('SYDNNI')
    expect(result.patternsMatched).toContain('decorative-spacing')
  })

  it.each([
    ['☼ 椰子派•𝒄𝒐𝒄𝒐𝒏𝒖𝒕 𝒑𝒊𝒆', '椰子派 Coconut Pie'],
    ['*𝓑𝓾𝓲𝓵𝓭.𝓛𝓲𝓰𝓱𝓽 𝓬𝓪𝓷𝓭𝓵𝓮*', 'Build.Light Candle'],
    ['Bonjour女人愛買鞋', 'Bonjour 女人愛買鞋'],
    ['FuSoap 台南手工皂', 'FuSoap 台南手工皂'],
    ['Dasuit大適坐墊', 'Dasuit 大適坐墊'],
  ])('handles combined cleanup for %s', (input, expected) => {
    expect(cleanBrandName(input).cleanedName).toBe(expected)
  })
})

describe('Taiwan-first bilingual brand identity', () => {
  it('builds the LID Shoes Taiwan-first identity without Han spacing', () => {
    expect(canonicalizeBilingualBrandName('LID Shoes', '劉一刀 手工鞋')).toBe(
      '劉一刀手工鞋 LID Shoes',
    )
    expect(
      canonicalizeBilingualBrandName(
        'LID Shoes',
        'LID Shoes | 劉一刀 手工鞋 | 官方網站',
      ),
    ).toBe('劉一刀手工鞋 LID Shoes')
  })

  it('uses the official bilingual title casing without duplicating the alias', () => {
    expect(canonicalizeBilingualBrandName('ADELA', 'Adela愛德拉')).toBe(
      '愛德拉 Adela',
    )
  })

  it('reorders an existing bilingual identity', () => {
    expect(
      canonicalizeBilingualBrandName('AROMASE 艾瑪絲', 'AROMASE 艾瑪絲'),
    ).toBe('艾瑪絲 AROMASE')
  })

  it('rejects an unrelated or legal-company title', () => {
    expect(
      canonicalizeBilingualBrandName('LID Shoes', '別家公司 Other Company'),
    ).toBeNull()
    expect(
      canonicalizeBilingualBrandName('LID Shoes', '劉一刀鞋業有限公司'),
    ).toBeNull()
  })

  it('recognizes only Han-first bilingual names', () => {
    expect(isTaiwanFirstBilingualBrandName('愛德拉 Adela')).toBe(true)
    expect(isTaiwanFirstBilingualBrandName('Adela 愛德拉')).toBe(false)
    expect(isTaiwanFirstBilingualBrandName('愛德拉')).toBe(false)
  })
})
