export function sanitizeJobError(error: unknown, maxLength = 2_000): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(
      /(Authorization\s*:\s*Basic\s+)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[REDACTED_JWT]',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      '[REDACTED_GITHUB_TOKEN]',
    )
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .slice(0, maxLength)
}
