const CJK_ALL_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60\uFE30-\uFE4F]/u
const LATIN_REGEX = /[A-Za-z]/u
const JUNK_IMAGE_TAGS = new Set(['promo', 'text_banner', 'irrelevant', 'logo'])

export type LanguageLocale = 'zh' | 'en'
export type LengthBand = readonly [min: number, max: number]
export type LabeledImage = {
  url: string
  junk: boolean
}

export function languagePurity(text: string, locale: LanguageLocale): number {
  const chars = Array.from(text).filter((char) => /\S/u.test(char))

  if (chars.length === 0) {
    return 1
  }

  const cjkCount = chars.filter((char) => CJK_ALL_REGEX.test(char)).length
  const latinCount = chars.filter((char) => LATIN_REGEX.test(char)).length
  const scriptChars = cjkCount + latinCount

  if (scriptChars === 0) {
    return 1
  }

  const cjkRatio = cjkCount / scriptChars
  return locale === 'zh' ? cjkRatio : 1 - cjkRatio
}

export function lengthBand(text: string, [min, max]: LengthBand): boolean {
  return text.length >= min && text.length <= max
}

export function classificationPrecision(
  labeled: readonly LabeledImage[],
  predicted: ReadonlyMap<string, string>
): number {
  if (labeled.length === 0) {
    return 1
  }

  const correct = labeled.filter((item) => {
    const tag = predicted.get(item.url)
    const predictedJunk = tag ? JUNK_IMAGE_TAGS.has(tag) : false
    return item.junk === predictedJunk
  }).length

  return correct / labeled.length
}
