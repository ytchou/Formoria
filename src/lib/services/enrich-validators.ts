import { languagePurity, lengthBand, type LanguageLocale, type LengthBand } from './eval/scorers'

export type LocalizedTextValidation = {
  ok: boolean
  reasons: string[]
}

const LANGUAGE_PURITY_THRESHOLD: Record<LanguageLocale, number> = {
  zh: 0.85,
  en: 0.98,
}

const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/u
const LATIN_WORD_REGEX = /^[A-Za-z][A-Za-z'&.-]*$/u
const MAX_LATIN_WORD_RUN_IN_ZH = 2

function hasLongLatinRun(text: string): boolean {
  const tokens = text.split(/[^\p{L}'&.-]+/u).filter(Boolean)
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

function failsLanguagePurity(text: string, locale: LanguageLocale): boolean {
  if (languagePurity(text, locale) < LANGUAGE_PURITY_THRESHOLD[locale]) {
    return true
  }

  if (locale === 'zh') {
    return hasLongLatinRun(text)
  }

  return CJK_REGEX.test(text)
}

export function validateLocalizedText(
  text: string,
  locale: LanguageLocale,
  band: LengthBand
): LocalizedTextValidation {
  const reasons: string[] = []

  if (failsLanguagePurity(text, locale)) {
    reasons.push('language_purity')
  }

  if (!lengthBand(text, band)) {
    reasons.push('length_band')
  }

  return {
    ok: reasons.length === 0,
    reasons,
  }
}
