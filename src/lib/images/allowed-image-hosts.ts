export const ALLOWED_IMAGE_HOSTS = [
  '*.supabase.co',
] as const satisfies string[]

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
