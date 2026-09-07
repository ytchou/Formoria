import { languagePurity, lengthBand, type LanguageLocale, type LengthBand } from './eval/scorers'

export type LocalizedTextValidation = {
  ok: boolean
  reasons: string[]   // hard failures (language_purity) — field gets nulled
  warnings: string[]  // soft signals (length_band) — field kept, logged
}

const LANGUAGE_PURITY_THRESHOLD: Record<LanguageLocale, number> = {
  zh: 0.70,
  en: 0.95,
}

const LATIN_WORD_REGEX = /^[A-Za-z][A-Za-z'&.-]*$/u
const MAX_LATIN_WORD_RUN_IN_ZH = 2

/**
 * Quoted spans hold proper nouns the writer cannot translate — album titles,
 * product model names, book titles. `孫燕姿《My Story, Your Song》湖水綠版` is
 * correct Traditional Chinese prose, but the four consecutive Latin words inside
 * the quotes used to trip the run check and null the whole description. The
 * overall purity ratio still runs against the untouched text, so stripping the
 * quoted spans here narrows the run check without opening the door to an
 * English description wearing quote marks.
 */
const QUOTED_SPAN_REGEX = /[《〈「『][^》〉」』]*[》〉」』]|[“"][^”"]*[”"]/gu

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A brand cannot be described without being named, and a name like
 * "Seal F Bikini" or "Hsin Jin Rain Boots" is itself a long Latin run. Removing
 * the brand's own name keeps both purity checks aimed at English prose that
 * leaked into Chinese text, which is what they exist to catch. The ratio check
 * needs it as much as the run check: in a 40-80 字 blurb, "Snowbell Handmade
 * Candle Cake" alone is enough Latin to sink the CJK ratio under 0.70 (DEV-1704).
 */
function stripExemptPhrase(text: string, exemptPhrase?: string | null): string {
  const phrase = exemptPhrase?.trim()
  if (!phrase) return text
  return text.replace(new RegExp(escapeForRegex(phrase), 'giu'), ' ')
}

function hasLongLatinRun(text: string): boolean {
  const scanned = text.replace(QUOTED_SPAN_REGEX, ' ')

  const tokens = scanned
    .split(/[^\p{L}'&.-]+/u)
    .filter(Boolean)
  let run = 0

  for (const token of tokens) {
    if (LATIN_WORD_REGEX.test(token)) {
      run += 1
      if (run > MAX_LATIN_WORD_RUN_IN_ZH) {
        return true
      }
      continue
    }

    run = 0
  }

  return false
}

function failsLanguagePurity(
  text: string,
  locale: LanguageLocale,
  exemptPhrase?: string | null
): boolean {
  const scanned = stripExemptPhrase(text, exemptPhrase)

  if (languagePurity(scanned, locale) < LANGUAGE_PURITY_THRESHOLD[locale]) {
    return true
  }

  if (locale === 'zh') {
    return hasLongLatinRun(scanned)
  }

  return false
}

export function validateLocalizedText(
  text: string,
  locale: LanguageLocale,
  band: LengthBand,
  /** Brand name, exempted from the Latin-word-run check — see hasLongLatinRun. */
  exemptPhrase?: string | null
): LocalizedTextValidation {
  const reasons: string[] = []
  const warnings: string[] = []

  if (failsLanguagePurity(text, locale, exemptPhrase)) {
    reasons.push('language_purity')
  }

  if (!lengthBand(text, band)) {
    if (locale === 'zh') {
      reasons.push('length_band')
    } else {
      warnings.push('length_band')
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
  }
}

const AI_SLOP_EN = [
  /^in a world where\b/i,
  /^in an era\b/i,
  /\bstands? as a testament\b/i,
  /\bpioneering\b/i,
  /\brevolutionary\b/i,
  /\bgame.?changing\b/i,
  /\bunparalleled\b/i,
  /\bunrivale?d\b/i,
  /\bredefining\b/i,
  /\bcutting.?edge\b/i,
  /\bseamlessly?\b/i,
  /\bmeticulously\b/i,
]

const AI_SLOP_ZH = [
  /^.{0,5}是一個台灣/,
  /^.{0,5}為台灣/,
  /(?:由於資訊有限|無法確認最新|根據現有資料|作為一個AI|作為一個語言模型|我無法確認|抱歉.*無法|我沒有.*相關資料)/,
  /(?:（|\()此處填入/,
  /XX公司/,
  /\[產品名稱\]/,
  /\[品牌名\]/,
  /希望這對你有幫助/,
  /以下是修改後的版本/,
  /如果需要.{0,5}調整/,
  /你可以直接複製/,
  /^.{0,15}作為.{0,15}品牌/,
  /^在當今/,
  /^隨著.{2,10}(的)?發展/,
  /^在這個.*的時代/,
  /^在.*市場環境中/,
  /^在.*浪潮下/,
  /^接下來.{0,5}(?:帶|讓)/,
  /^廢話不多說/,
  /^帶大家了解/,
  /^讓我們一起來看看/,
  /(?:未來充滿.*可能|讓我們一起.*未來|總的來說|綜上所述|總而言之|在未來的道路上|攜手.*共同.*未來)/,
  /(?:標誌著|見證了|奠定.*基礎|里程碑|不可磨滅)/,
  /展現了.*(?:精神|堅持|承諾|理念)/,
  /體現了.*(?:精神|堅持)/,
  /(?:彰顯了|突顯了)/,
  /(?:充滿啟發|全新高峰|突破自我|擁抱改變)/,
  /(?:獲得多家媒體報導|廣受好評|引發.*熱烈討論)/,
  /(?:不只是.*更是|不僅.*更是)/,
  /(?:說到底|歸根究柢|核心在於)/,
  /首先.*其次/,
  /(?:賦能|閉環)/,
  /儘管.*但.*持續/,
  /(?:榮獲.*大獎|被.*評為)/,
]

export function detectAiArtifacts(text: string, locale: LanguageLocale): string[] {
  const patterns = locale === 'en' ? AI_SLOP_EN : AI_SLOP_ZH
  return patterns
    .filter((re) => re.test(text))
    .map((re) => `ai_artifact:${re.source}`)
}

// ---------------------------------------------------------------------------
// Product description validators
// ---------------------------------------------------------------------------

export const PRODUCT_DESCRIPTION_FORBIDDEN_TERMS: readonly string[] = [
  '值得',
  '必買',
  '療癒',
  '質感絕佳',
  '獨特',
  '讓你',
  '適合喜歡',
  '你會發現',
  '高品質',
  '精心設計',
  '用心製作',
  '價格',
  '售價',
  '特價',
  '折扣',
  '庫存',
  '現貨',
  '缺貨',
  '運費',
  '到貨',
  '出貨',
  '規格選擇',
]

export const PRICING_OVERLAP_TERMS: ReadonlySet<string> = new Set(
  PRODUCT_DESCRIPTION_FORBIDDEN_TERMS.filter((t) =>
    ['價格', '售價', '特價', '折扣'].includes(t),
  ),
)

export function findForbiddenProductTerms(text: string): string[] {
  const hits: string[] = []
  for (const term of PRODUCT_DESCRIPTION_FORBIDDEN_TERMS) {
    if (text.includes(term)) {
      hits.push(term)
    }
  }
  return hits
}

export function restatesProductName(nameZh: string, description: string): boolean {
  const trimmedName = nameZh.trim()
  const trimmedDesc = description.trim()
  const prefix = trimmedName.replace(/\s+[A-Za-z0-9-]+$/, '')
  if (prefix.length < 2) return false
  return trimmedDesc.startsWith(prefix)
}

export function containsPricingInformation(
  value: string,
  locale: 'zh' | 'en',
): boolean {
  const sentences = value.split(locale === 'zh' ? /[。！？]/u : /[.!?]+\s+/u)
  return sentences.some((sentence) => {
    if (locale === 'zh') {
      if (
        /(?:價格|價位|價錢|售價|定價|加價|平價|中價|高價|低價|千元即可入手|不再昂貴|折扣|優惠|促銷|特價|買一送一|滿額)/u.test(
          sentence,
        )
      ) {
        return true
      }
      const hasMoney = /(?:NT[$.]?|TWD|新台幣|台幣)\s*[\d,]+|[\d,]+\s*元/u.test(
        sentence,
      )
      const isNonPricingAmount =
        /(?:保險|理賠|集資|募資|銷售額|業績|佳績)/u.test(sentence)
      return hasMoney && !isNonPricingAmount
    }

    if (
      /\b(?:prices?|priced|pricing|affordable|budget(?:-friendly)?|discount(?:ed|s)?|promotion(?:al|s)?)\b|\b(?:on sale|sale price)\b/iu.test(
        sentence,
      )
    ) {
      return true
    }
    const hasMoney = /(?:NT\$|TWD|US\$|\$)\s*[\d,]+/iu.test(sentence)
    const isNonPricingAmount =
      /\b(?:insurance|insured|coverage|crowdfunding|fundraising|raised|sales|revenue)\b/iu.test(
        sentence,
      )
    return hasMoney && !isNonPricingAmount
  })
}
