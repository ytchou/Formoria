const DEFAULT_MAX_LENGTH = 155
const SENTENCE_BOUNDARY_PATTERN = /[。！？.!?]/u

export function truncateForMeta(text: string, max = DEFAULT_MAX_LENGTH): string {
  const normalized = text.trim()

  if (max <= 0) return ''
  if (normalized.length <= max) return normalized

  let lastBoundary = -1

  for (let index = 0; index < normalized.length && index < max; index += 1) {
    if (SENTENCE_BOUNDARY_PATTERN.test(normalized[index] ?? '')) {
      lastBoundary = index + 1
    }
  }

  if (lastBoundary > 0) {
    return normalized.slice(0, lastBoundary).trim()
  }

  return `${normalized.slice(0, max).trimEnd()}…`
}
