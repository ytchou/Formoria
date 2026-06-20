export type CleanupPattern =
  | 'emoji'
  | 'decorative-unicode'
  | 'stylized-text'
  | 'bracket-noise'
  | 'marketing-suffix'
  | 'product-descriptor'
  | 'tagline-separator'
  | 'decorative-spacing'

export interface NameCleanupResult {
  originalName: string
  cleanedName: string
  changed: boolean
  patternsMatched: CleanupPattern[]
  confidence: 'high' | 'medium' | 'low'
}

export interface NonBrandDetectionResult {
  isNonBrand: boolean
  reason: string | null
  confidence: 'high' | 'medium' | 'low'
}

export interface SlugNormalizationResult {
  newSlug: string | null
  source: 'unchanged' | 'scraped-english-name'
}

interface BrandLike {
  name: string
  description?: string | null
  purchaseWebsite?: string | null
}

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu
const VARIATION_SELECTOR_REGEX = /\uFE0F/g
const DECORATIVE_SYMBOL_REGEX = /[◜◌☼✧◆★●•*♡♥❖✦✩✪✫✬✭✮✯✰]+/gu
const BRACKET_NOISE_REGEX = /^【\s*([^】]+?)\s*】.*$/u
const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/
const ASCII_LATIN_REGEX = /^[\u0000-\u007F]+$/
const STYLIZED_RUN_REGEX = /[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}][\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}\s.'-]*[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}]|[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}]/gu
const DECORATIVE_SPACING_REGEX = /^(?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9]$/u
const ENGLISH_CJK_BOUNDARY_REGEX = /([A-Za-z0-9])([\u4E00-\u9FFF\u3400-\u4DBF])/gu
const CJK_ENGLISH_BOUNDARY_REGEX = /([\u4E00-\u9FFF\u3400-\u4DBF])([A-Za-z0-9])/gu
const RESELLER_KEYWORDS = ['代理', '經銷', '批發', '代購']
const CHARITY_KEYWORDS = ['基金會', '協會', '社團法人', '認養']
const GOVERNMENT_KEYWORDS = ['鄉公所', '區公所', '市政府']
const NOISE_NAMES = ['首頁', '關於我們']
const NON_BRAND_KEYWORDS = [
  ...RESELLER_KEYWORDS,
  ...CHARITY_KEYWORDS,
  ...GOVERNMENT_KEYWORDS,
  ...NOISE_NAMES,
]

const MATH_LETTER_RANGES: Array<{ start: number; chars: string }> = [
  range(0x1D400, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D41A, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D434, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D44E, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D468, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D482, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D49C, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D4B6, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D4D0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D4EA, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D504, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D51E, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D56C, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D586, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D5A0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D5BA, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D5D4, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D5EE, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D608, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D622, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D63C, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D656, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D670, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  range(0x1D68A, 'abcdefghijklmnopqrstuvwxyz'),
  range(0x1D7CE, '0123456789'),
  range(0x1D7D8, '0123456789'),
  range(0x1D7E2, '0123456789'),
  range(0x1D7EC, '0123456789'),
  range(0x1D7F6, '0123456789'),
]

const SMALL_CAPS_MAP = new Map<string, string>([
  ['ᴀ', 'A'],
  ['ʙ', 'B'],
  ['ᴄ', 'C'],
  ['ᴅ', 'D'],
  ['ᴇ', 'E'],
  ['ꜰ', 'F'],
  ['ɢ', 'G'],
  ['ʜ', 'H'],
  ['ɪ', 'I'],
  ['ᴊ', 'J'],
  ['ᴋ', 'K'],
  ['ʟ', 'L'],
  ['ᴍ', 'M'],
  ['ɴ', 'N'],
  ['ᴏ', 'O'],
  ['ᴘ', 'P'],
  ['ǫ', 'Q'],
  ['ʀ', 'R'],
  ['ꜱ', 'S'],
  ['ᴛ', 'T'],
  ['ᴜ', 'U'],
  ['ᴠ', 'V'],
  ['ᴡ', 'W'],
  ['ˣ', 'X'],
  ['ʏ', 'Y'],
  ['ᴢ', 'Z'],
])

function range(start: number, chars: string): { start: number; chars: string } {
  return { start, chars }
}

function addPattern(patterns: CleanupPattern[], pattern: CleanupPattern): void {
  if (!patterns.includes(pattern)) {
    patterns.push(pattern)
  }
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function ensureEnglishCjkSpacing(value: string): string {
  return value
    .replace(ENGLISH_CJK_BOUNDARY_REGEX, '$1 $2')
    .replace(CJK_ENGLISH_BOUNDARY_REGEX, '$1 $2')
}

function isStylizedCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x1D400 && codePoint <= 0x1D7FF) || (codePoint >= 0x1D00 && codePoint <= 0x1D22)
}

function mapStylizedCharacter(char: string): string {
  const smallCap = SMALL_CAPS_MAP.get(char)

  if (smallCap) {
    return smallCap
  }

  const codePoint = char.codePointAt(0)

  if (codePoint === undefined || !isStylizedCodePoint(codePoint)) {
    return char
  }

  for (const { start, chars } of MATH_LETTER_RANGES) {
    const index = codePoint - start

    if (index >= 0 && index < chars.length) {
      return chars[index] ?? char
    }
  }

  return char
}

function titleCaseStylizedSegment(value: string): string {
  return value.replace(/[A-Za-z]+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function normalizeStylizedText(value: string): string {
  return value.replace(STYLIZED_RUN_REGEX, (segment) => {
    const normalized = [...segment].map(mapStylizedCharacter).join('')
    return titleCaseStylizedSegment(normalized)
  })
}

function removeMarketingSuffixes(value: string): string {
  let result = value
    .replace(/\s*(?:┃|｜|\||—)\s*.*$/u, '')
    .replace(/\s*台灣(?:獨家)?代理\s*$/u, '')
    .replace(/\s*(?:MIT\s*)?[^A-Za-z\s]{0,4}(?:專賣店|旗艦館|設計館|品牌專區)\s*$/u, '')

  // Only strip 品牌$ suffix when the brand part (before the last CJK word) contains no CJK.
  // If the brand name already contains CJK (bilingual brand label), treat the trailing phrase
  // as a tagline and let removeTaglines() handle it instead.
  const brandPartWithoutSuffix = result.replace(/\s+\S+品牌$/u, '')

  if (!CJK_REGEX.test(brandPartWithoutSuffix)) {
    result = result.replace(/\s*(?:原創品)?[^A-Za-z\s]{0,8}品牌$/u, '')
  }

  return result
}

function removeProductDescriptors(value: string): string {
  return value
    .replace(/\s*(?:與?童畫包|故事鞋與童畫包|女人愛買鞋|台南手工皂|質感矽膠嬰幼餐具|經典手工鞋|手工鞋|面膜|坐墊|翻頁鐘|餐具|手工皂|防水包|故事鞋|愛買鞋)\s*$/u, '')
}

function removeTaglines(value: string): string {
  let next = value.replace(/\s*(?:┃|｜|\||—)\s*.*$/u, '')

  // Normalize multiple spaces before CJK to single space (single space is preserved for bilingual guard)
  next = next.replace(/^([A-Za-z0-9][A-Za-z0-9.'-]*)(?:\s{2,})(?=[\u4E00-\u9FFF\u3400-\u4DBF])/u, '$1 ')

  // Guard: English + single-space + short CJK (1–6 chars, nothing after) is a bilingual brand
  // name, not a tagline — leave it untouched.
  if (/^[A-Za-z0-9][A-Za-z0-9.'-]*\s+[\u4E00-\u9FFF\u3400-\u4DBF]{1,6}$/.test(next)) {
    return next
  }

  const englishThenChineseBrand = next.match(
    /^([A-Za-z0-9][A-Za-z0-9.'-]*)([\u4E00-\u9FFF\u3400-\u4DBF]{1,6})\s+[\u4E00-\u9FFF\u3400-\u4DBF\sXx]+$/u
  )

  if (englishThenChineseBrand) {
    return `${englishThenChineseBrand[1]} ${englishThenChineseBrand[2]}`
  }

  return next
    .replace(/^([A-Za-z0-9][A-Za-z0-9.'-]*)\s+[\u4E00-\u9FFF\u3400-\u4DBF].*$/u, '$1')
    .replace(/^([A-Za-z0-9][A-Za-z0-9.'-]*)\s{2,}[\u4E00-\u9FFF\u3400-\u4DBF].*$/u, '$1')
}

function confidenceFor(patterns: CleanupPattern[]): NameCleanupResult['confidence'] {
  if (
    patterns.some((pattern) =>
      ['emoji', 'bracket-noise', 'decorative-unicode', 'decorative-spacing'].includes(pattern)
    )
  ) {
    return 'high'
  }

  return patterns.length > 0 ? 'medium' : 'high'
}

export function cleanBrandName(name: string): NameCleanupResult {
  const originalName = name
  const patternsMatched: CleanupPattern[] = []
  let cleanedName = name

  // Decorative symbols are removed first so that legacy symbol characters (e.g. ☼, •)
  // which also appear in Extended_Pictographic are attributed to 'decorative-unicode'
  // rather than 'emoji'.
  const withoutDecorative = cleanedName.replace(DECORATIVE_SYMBOL_REGEX, ' ')

  if (withoutDecorative !== cleanedName) {
    cleanedName = withoutDecorative
    addPattern(patternsMatched, 'decorative-unicode')
  }

  EMOJI_REGEX.lastIndex = 0
  const withoutEmoji = cleanedName.replace(EMOJI_REGEX, '').replace(VARIATION_SELECTOR_REGEX, '')

  if (withoutEmoji !== cleanedName) {
    cleanedName = withoutEmoji
    addPattern(patternsMatched, 'emoji')
  }

  const withoutStylized = normalizeStylizedText(cleanedName)

  if (withoutStylized !== cleanedName) {
    cleanedName = withoutStylized
    addPattern(patternsMatched, 'stylized-text')
  }

  const bracketMatch = cleanedName.match(BRACKET_NOISE_REGEX)

  if (bracketMatch?.[1]) {
    cleanedName = bracketMatch[1]
    addPattern(patternsMatched, 'bracket-noise')
  }

  const withoutMarketingSuffix = removeMarketingSuffixes(cleanedName)

  if (withoutMarketingSuffix !== cleanedName) {
    cleanedName = withoutMarketingSuffix
    addPattern(patternsMatched, 'marketing-suffix')
  }

  const withoutProductDescriptor = removeProductDescriptors(cleanedName)

  if (withoutProductDescriptor !== cleanedName) {
    cleanedName = withoutProductDescriptor
    addPattern(patternsMatched, 'product-descriptor')
  }

  const withoutTagline = removeTaglines(cleanedName)

  if (withoutTagline !== cleanedName) {
    cleanedName = withoutTagline
    addPattern(patternsMatched, 'tagline-separator')
  }

  if (DECORATIVE_SPACING_REGEX.test(cleanedName)) {
    cleanedName = cleanedName.replace(/\s+/gu, '')
    addPattern(patternsMatched, 'decorative-spacing')
  }

  cleanedName = compactWhitespace(ensureEnglishCjkSpacing(cleanedName))

  if (cleanedName.length === 0) {
    return {
      originalName,
      cleanedName: originalName,
      changed: false,
      patternsMatched,
      confidence: 'low',
    }
  }

  return {
    originalName,
    cleanedName,
    changed: cleanedName !== originalName,
    patternsMatched: cleanedName === originalName ? [] : patternsMatched,
    confidence: confidenceFor(patternsMatched),
  }
}

export function detectNonBrand(brand: BrandLike): NonBrandDetectionResult {
  const matchedKeyword = NON_BRAND_KEYWORDS.find((keyword) =>
    NOISE_NAMES.includes(keyword) ? brand.name === keyword : brand.name.includes(keyword)
  )

  if (matchedKeyword) {
    return {
      isNonBrand: true,
      reason: matchedKeyword,
      confidence: 'high',
    }
  }

  return {
    isNonBrand: false,
    reason: null,
    confidence: 'high',
  }
}

export function normalizeSlug(
  slug: string,
  scrapedBrandName: string | null
): SlugNormalizationResult {
  if (!CJK_REGEX.test(slug) || !scrapedBrandName || !ASCII_LATIN_REGEX.test(scrapedBrandName)) {
    return {
      newSlug: null,
      source: 'unchanged',
    }
  }

  const newSlug = scrapedBrandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '')

  if (!newSlug || CJK_REGEX.test(newSlug)) {
    return {
      newSlug: null,
      source: 'unchanged',
    }
  }

  return {
    newSlug,
    source: 'scraped-english-name',
  }
}
