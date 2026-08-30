type CleanupPattern =
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

const SEO_JUNK_KEYWORDS = ['推薦', '必買', '伴手禮', '評價', '優惠', '折扣', '開箱', '比較']
const LEGAL_COMPANY_MARKERS = [
  '有限公司',
  '股份有限公司',
  '企業社',
  '商行',
  'company limited',
  'co., ltd',
  'co. ltd',
  'incorporated',
]
const MAX_SUBMISSION_BRAND_NAME_LENGTH = 100
const HAN_REGEX = /\p{Script=Han}/u
const LATIN_REGEX = /\p{Script=Latin}/u

/**
 * Is `candidate` a plausible replacement for `current`?
 *
 * Guards every automated rename: a proposal must be short, free of SEO copy,
 * and share at least one token with the name it replaces, so a page title that
 * happens to mention a different company cannot silently rebrand a record.
 * Lives here rather than in a phase module because both the detect phase (LLM
 * proposals) and the links phase (scraped page titles) rename from it.
 */
export function isValidBrandName(candidate: string, current: string): boolean {
  if (candidate.length > MAX_SUBMISSION_BRAND_NAME_LENGTH) return false
  if (SEO_JUNK_KEYWORDS.some((keyword) => candidate.includes(keyword))) return false
  const lowerCandidate = candidate.toLowerCase()
  if (LEGAL_COMPANY_MARKERS.some((marker) => lowerCandidate.includes(marker))) return false
  // Overlap is compared case-insensitively: `ADELA` and `Adela` are the same
  // token, and cleanBrandName re-cases names, so a case-sensitive check
  // rejected every rename that only fixed capitalisation.
  const lowerCurrent = current.toLowerCase()
  const currentWords = lowerCurrent.split(/[\s\-]+/).filter(Boolean)
  const candidateWords = lowerCandidate.split(/[\s\-]+/).filter(Boolean)
  return (
    currentWords.some((word) => lowerCandidate.includes(word)) ||
    candidateWords.some((word) => lowerCurrent.includes(word))
  )
}

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu
const VARIATION_SELECTOR_REGEX = /\uFE0F/g
const DECORATIVE_SYMBOL_REGEX = /[◜◌☼✧◆★●•*♡♥❖✦✩✪✫✬✭✮✯✰]+/gu
const BRACKET_NOISE_REGEX = /^【\s*([^】]+?)\s*】.*$/u
const STYLIZED_RUN_REGEX = /[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}][\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}\s.'-]*[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}]|[\u{1D400}-\u{1D7FF}\u{1D00}-\u{1D22}]/gu
const DECORATIVE_SPACING_REGEX = /^(?:[A-Za-z0-9]\s+){2,}[A-Za-z0-9]$/u
const ENGLISH_CJK_BOUNDARY_REGEX = /(?<=[A-Za-z0-9]{2,})(?=[\u4E00-\u9FFF\u3400-\u4DBF]{2,})/gu
const CJK_ENGLISH_BOUNDARY_REGEX = /(?<=[\u4E00-\u9FFF\u3400-\u4DBF]{2,})(?=[A-Za-z0-9]{2,})/gu

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

/**
 * Title-cases an all-lowercase Latin run. Deliberately NOT part of
 * `cleanBrandName`: a stored brand name's casing is identity, and re-casing it
 * turned `qn dessert` into `Qn Dessert` and `一屋 1woof` into `一屋 1Woof` on
 * live rows (DEV-1321).
 *
 * A scraped page title is the opposite case — its lowercasing is usually CSS
 * or the site's own styling rather than a decision, which is why `adela.tw`
 * yields `adela愛德拉`. So only the page-title path calls this, and only on a
 * candidate it is already proposing as an improvement.
 *
 * Skips anything already carrying uppercase (the site made a choice) or
 * Latin-1/extended accents, where naive `charAt(0).toUpperCase()` misfires.
 */
export function titleCaseScrapedTitle(value: string): string {
  if (!/[a-z]/u.test(value) || /[A-Z]/u.test(value)) {
    return value
  }
  if (/[À-ɏ]/u.test(value)) {
    return value
  }
  return value.replace(/\d+(?:st|nd|rd|th)\b|[a-z]+/gu, (word) => {
    if (/\d/.test(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1)
  })
}

function ensureEnglishCjkSpacing(value: string): string {
  return value
    .replace(ENGLISH_CJK_BOUNDARY_REGEX, ' ')
    .replace(CJK_ENGLISH_BOUNDARY_REGEX, ' ')
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

const SEGMENT_SPLIT_REGEX = /(?:\s*[┃｜|—]\s*|\s+[-–]\s+)/u

/**
 * Page-title chrome that is never part of a brand name. Matched against a whole
 * segment, lowercased — a brand genuinely called `Home` survives, because it
 * would have to be the only segment and a lone segment is never split.
 */
const PAGE_TITLE_BOILERPLATE = new Set([
  '首頁',
  '官網',
  '官方網站',
  '官方網',
  '線上購物',
  '購物網',
  '購物網站',
  '網路商店',
  'home',
  'official site',
  'official store',
  'official shop',
])

/**
 * Keeps the first segment that is not page-title chrome.
 *
 * A separator is the only *evidence* this module gets that its author marked
 * where the name ends. Everything shape-based was removed: a space-delimited
 * CJK run may be a tagline (`故事鞋與童畫包`) or half the brand's own name
 * (`慢火金工創作室`), and nothing but meaning separates the two — so the `names`
 * arbitration phase decides and no regex guesses here. Guessing is what
 * truncated `UNIGAZE 慢火金工創作室` to `UNIGAZE` on live rows (DEV-1321).
 *
 * `-` and `–` need spaces on both sides so `Bo-Bird` and `LIN,YUAN-MAI` stay
 * intact; `┃`, `｜`, `|`, and `—` separate wherever they appear.
 */
function stripSeparatorSegments(value: string): string {
  const segments = value
    .split(SEGMENT_SPLIT_REGEX)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length <= 1) return value

  return (
    segments.find((segment) => !PAGE_TITLE_BOILERPLATE.has(segment.toLowerCase())) ??
    segments[0] ??
    value
  )
}

function removeMarketingSuffixes(value: string): string {
  let result = value
    .replace(/\s*台灣(?:獨家)?代理\s*$/u, '')
    .replace(/\s*(?:MIT\s*)?[^A-Za-z\s]{0,4}(?:專賣店|旗艦館|設計館|品牌專區)\s*$/u, '')

  // Only strip 品牌$ suffix when the brand part (before the last CJK word) contains no CJK.
  // If the brand name already contains CJK (bilingual brand label), the trailing phrase is
  // ambiguous — `AROMASE艾瑪絲 頭皮療癒永續品牌` reads as a tagline, but the same shape can be
  // the registered name — so it is left intact for the `names` arbitration phase to judge.
  const brandPartWithoutSuffix = result.replace(/\s+\S+品牌$/u, '')

  if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(brandPartWithoutSuffix)) {
    result = result.replace(/\s*(?:原創品)?[^A-Za-z\s]{0,8}品牌$/u, '')
  }

  return result
}

/**
 * `工作室` and `工坊` are deliberately absent: they read as "studio/workshop"
 * but are part of the registered name far more often than not — `藺草工坊`,
 * `謝工作室`, `羊泥工坊`, `暮苒甜點工作室` are all live rows that this list
 * truncated. What remains describes an offer, never an identity.
 */
function removeProductDescriptors(value: string): string {
  return value
    .replace(/\.com(?:\.tw)?$/iu, '')
    .replace(/\s*(?:可以客製|客製化|限量手作)\s*$/u, '')
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

  // Runs before the suffix and descriptor strips so those see one segment rather than a whole
  // page title: `Change Tone 襪子專賣店┃100%台灣設計製造` has to become `Change Tone 襪子專賣店`
  // before `襪子專賣店` is recognisable as a trailing marketing suffix.
  const withoutSeparatorSegments = stripSeparatorSegments(cleanedName)

  if (withoutSeparatorSegments !== cleanedName) {
    cleanedName = withoutSeparatorSegments
    addPattern(patternsMatched, 'tagline-separator')
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

  if (DECORATIVE_SPACING_REGEX.test(cleanedName)) {
    cleanedName = cleanedName.replace(/\s+/gu, '')
    addPattern(patternsMatched, 'decorative-spacing')
  }

  cleanedName = cleanedName.replace(/^[_\s]+|[_\s]+$/gu, '')
  // No case normalisation: `qn dessert` and `一屋 1woof` are lowercase on purpose, and
  // re-casing them rewrote brand identity on live rows (DEV-1321). Casing is presentation,
  // not junk, so only the stylized-text decoder (which has to pick a case) touches it.
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

function compactHanWhitespace(value: string): string {
  return value.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
}

function latinIdentityRuns(value: string): string[] {
  return (value.match(
    /[\p{Script=Latin}\p{Number}][\p{Script=Latin}\p{Number}\s&+.'’’,_-]*/gu,
  ) ?? [])
    .map((run) => run.trim())
    .filter(Boolean)
}

function latinIdentity(value: string): string | null {
  const identity = latinIdentityRuns(value).join(' ').trim()
  return identity || null
}

function hanIdentity(value: string): string | null {
  const runs = value.match(/\p{Script=Han}+(?:\s+\p{Script=Han}+)*/gu)
  const identity = compactHanWhitespace(runs?.join(' ') ?? '').trim()
  return identity || null
}

function latinIdentityKey(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[^\p{Script=Latin}\p{Number}]/gu, '')
}

export function isBilingualBrandName(value: string): boolean {
  return HAN_REGEX.test(value) && LATIN_REGEX.test(value)
}

export function isTaiwanFirstBilingualBrandName(value: string): boolean {
  if (!isBilingualBrandName(value)) return false
  const hanIndex = value.search(/\p{Script=Han}/u)
  const latinIndex = value.search(/\p{Script=Latin}/u)
  return hanIndex >= 0 && latinIndex >= 0 && hanIndex < latinIndex
}

/**
 * Builds a Taiwan-first bilingual identity from an existing name and a name
 * observed on a first-party page. It only rearranges supplied text: the Han
 * half comes from the observation and the Latin half comes from either the
 * same observation or the stored identity. Nothing is translated or coined.
 */
export function canonicalizeBilingualBrandName(
  currentName: string,
  observedName: string,
): string | null {
  const current = cleanBrandName(currentName).cleanedName.trim()
  const observed = compactWhitespace(
    observedName
      .split(SEGMENT_SPLIT_REGEX)
      .map((segment) => segment.trim())
      .filter(
        (segment) =>
          segment !== '' &&
          !PAGE_TITLE_BOILERPLATE.has(segment.toLocaleLowerCase()),
      )
      .map((segment) => cleanBrandName(segment).cleanedName.trim())
      .filter(Boolean)
      .join(' '),
  )
  if (!current || !observed) return null

  const currentLatin = latinIdentity(current)
  const observedHan = hanIdentity(observed) ?? hanIdentity(current)
  if (!currentLatin || !observedHan) return null

  const currentKey = latinIdentityKey(currentLatin)
  const observedLatinRuns = latinIdentityRuns(observed)
  const observedLatin = observedLatinRuns.find(
    (run) => latinIdentityKey(run) === currentKey,
  )
  if (observedLatinRuns.length > 0 && !observedLatin) return null

  const english = observedLatin ?? currentLatin
  const candidate = compactWhitespace(`${observedHan} ${english}`)
  if (!isTaiwanFirstBilingualBrandName(candidate)) return null
  if (!isValidBrandName(candidate, currentName)) return null
  return candidate
}
