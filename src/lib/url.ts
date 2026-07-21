const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
])

export function isPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    const hostname = parsed.hostname

    if (BLOCKED_HOSTNAMES.has(hostname)) return true

    const parts = hostname.split('.')
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
      const [first = -1, second = -1] = parts.map(Number)
      if (first === 10) return true
      if (first === 172 && second >= 16 && second <= 31) return true
      if (first === 192 && second === 168) return true
      if (first === 169 && second === 254) return true
      if (first === 0) return true
    }

    return parsed.protocol !== 'https:' && parsed.protocol !== 'http:'
  } catch {
    return true
  }
}

export function normalizeToRootUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return url
  }
}

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
