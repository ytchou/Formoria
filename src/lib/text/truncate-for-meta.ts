const DEFAULT_MAX_LENGTH = 155
// A boundary earlier than this share of `max` would ship a stub ("Tan.") as
// the whole description, so it is ignored in favour of a later one or the cut.
const MIN_BOUNDARY_RATIO = 0.6
const CJK_BOUNDARY_PATTERN = /[。！？]/u
const LATIN_BOUNDARY_PATTERN = /[.!?]/
const WHITESPACE_PATTERN = /\s/u

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index] ?? ''
  if (CJK_BOUNDARY_PATTERN.test(char)) return true
  if (!LATIN_BOUNDARY_PATTERN.test(char)) return false
  // A Latin stop ends a sentence only before whitespace or the end of the
  // text; otherwise it sits inside a token ("Tan.Nichi", "golday.jewelry", "1.5cm").
  const next = text[index + 1]
  return next === undefined || WHITESPACE_PATTERN.test(next)
}

export function truncateForMeta(text: string, max = DEFAULT_MAX_LENGTH): string {
  const normalized = text.trim()

  if (max <= 0) return ''
  if (normalized.length <= max) return normalized

  let lastBoundary = -1

  for (let index = 0; index < normalized.length && index < max; index += 1) {
    if (isSentenceBoundary(normalized, index)) {
      lastBoundary = index + 1
    }
  }

  if (lastBoundary > 0 && lastBoundary >= max * MIN_BOUNDARY_RATIO) {
    return normalized.slice(0, lastBoundary).trim()
  }

  return `${normalized.slice(0, max).trimEnd()}…`
}
