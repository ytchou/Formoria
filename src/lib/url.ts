export function sanitizeHref(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  return `https://${trimmed}`
}

export function normalizeInstagramHref(
  value: string | undefined | null,
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return sanitizeHref(trimmed)
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  return sanitizeHref(`https://instagram.com/${handle}`)
}

export function normalizeThreadsHref(
  value: string | undefined | null,
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return sanitizeHref(trimmed)
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  return sanitizeHref(`https://threads.net/@${handle}`)
}
