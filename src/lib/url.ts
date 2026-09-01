const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
])

export function isPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    const hostname = parsed.hostname.toLowerCase()

    if (BLOCKED_HOSTNAMES.has(hostname)) return true

    const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    if (
      ipv6 === '::' ||
      ipv6 === '::1' ||
      /^f[cd][0-9a-f]{2}(?::|$)/.test(ipv6) ||
      /^fe[89ab][0-9a-f](?::|$)/.test(ipv6)
    ) {
      return true
    }

    const parts = hostname.split('.')
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
      const [first = -1, second = -1] = parts.map(Number)
      if (first === 127) return true
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

/**
 * Derive the public-facing origin from a server-side request.
 *
 * Behind Railway + Cloudflare, `request.url` resolves to the internal listen
 * address (e.g. `https://localhost:8080`). The `host` header carries the real
 * hostname that the client connected to.
 */
export function getPublicOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https'
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
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

/**
 * Drops the query string a copied link carries (`utm_*`, share ids, session
 * tokens). Shared by the brand submission flow and the correction dialog so a
 * pasted URL reaches the queue in the same cleaned shape from either entry
 * point.
 */
export function stripUrlQuery(value: string): string {
  const [base = ''] = value.split('?')
  return base
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

/**
 * Decode a route path segment, or `null` when it carries a malformed
 * percent-escape.
 *
 * `decodeURIComponent('%zz')` throws `URIError`. Thrown from a route's
 * `generateMetadata` or page body that becomes a 500 rendered through the
 * error boundary — plus one error report per crawler probe — for a request
 * whose honest answer is 404. Call sites turn `null` into `notFound()`.
 */
export function safeDecodeSlug(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
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
