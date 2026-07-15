export function sanitizeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[REDACTED_JWT]',
    )
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .slice(0, 2_000)
}
