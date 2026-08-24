/**
 * Remote hosts an `<img src>` may point at. EMPTY since DEV-1551 task 11.
 *
 * `*.supabase.co` was the only entry, and it is gone because the `brand-images`
 * bucket is now private: a public storage URL no longer resolves, and the
 * same-origin `/i/` proxy serves every image we own. `safeImageSrc` handles
 * that case in its leading-slash branch, which is why an empty list does not
 * mean "no images".
 *
 * Adding a host back re-opens hotlinking, so it needs a stated reason. Note
 * that signed submission URLs live on `*.supabase.co` too — those render
 * through a plain `<img>` in admin review, so they are governed by the CSP
 * `img-src` list in `next.config.ts`, NOT by this one.
 */
// The explicit annotation keeps the list EMPTY while still typing its elements
// as strings: an empty `as const` array narrows to `never[]`, which makes the
// pattern matching below fail to compile.
export const ALLOWED_IMAGE_HOSTS: readonly string[] = []

const NON_IMAGE_HOSTS = [
  'facebook.com',
  'line.me',
  'instagram.com',
  'cdninstagram.com',
] as const

export function isAllowedImageHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase()

  return ALLOWED_IMAGE_HOSTS.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase()

    if (normalizedPattern.startsWith('**.')) {
      const suffix = normalizedPattern.slice(3)
      return normalizedHostname.endsWith(`.${suffix}`)
    }

    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(2)
      return normalizedHostname.endsWith(`.${suffix}`)
    }

    return normalizedHostname === normalizedPattern
  })
}

export function isNonImageHost(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    const normalizedHostname = parsedUrl.hostname.toLowerCase()

    return NON_IMAGE_HOSTS.some(
      (host) =>
        normalizedHostname === host ||
        normalizedHostname.endsWith(`.${host}`),
    )
  } catch {
    return false
  }
}

export function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }

  const value = url.trim()
  if (!value) {
    return null
  }

  /*
   * A protocol-relative URL starts with `/` but fetches OFFSITE, so it has to
   * be rejected before the same-origin branch below — a bare leading-slash
   * check would wave `//evil.example/x.png` straight through the host gate.
   */
  if (value.startsWith('//')) {
    return null
  }

  /*
   * Same-origin absolute paths pass through unchanged: `/i/…` (the image
   * proxy, DEV-1551) and `/images/…` (repo assets). `new URL(value)` with no
   * base throws on both, which is why callers used to hand-roll their own
   * leading-slash branch before calling this.
   *
   * A backslash is refused because some clients normalise `/\host` to `//host`,
   * which is the protocol-relative case again.
   */
  if (value.startsWith('/')) {
    return value.includes('\\') ? null : value
  }

  try {
    const parsedUrl = new URL(value)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null
    }

    if (!isAllowedImageHost(parsedUrl.hostname)) {
      return null
    }

    parsedUrl.protocol = 'https:'
    return parsedUrl.toString()
  } catch {
    return null
  }
}
