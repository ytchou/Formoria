/**
 * The storage host of the configured Supabase project, e.g.
 * `xkcayngbttpxyibgzern.supabase.co`, or `null` when unconfigured.
 *
 * Derived from `NEXT_PUBLIC_SUPABASE_URL` rather than hardcoded so staging and
 * production each allow their OWN project only — a wildcard `*.supabase.co`
 * would let any Supabase project on the internet render inside our pages.
 */
function supabaseStorageHost(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!configuredUrl) return null
  try {
    return new URL(configuredUrl).hostname
  } catch {
    return null
  }
}

/**
 * Remote hosts an `<img src>` may point at.
 *
 * The configured Supabase project host is back since DEV-1744 task 3: the
 * `brand-images` bucket is public again and `imagePathToUrl` addresses
 * `brands/`, `curated-products/` and `event-exhibitors/` objects by their
 * public storage URL, so `safeImageSrc` and `next/image` both have to accept
 * that host. Without it every published image silently resolves to null.
 *
 * It stays HOST-EXACT (no wildcard) and the list stays otherwise empty:
 * anything else added here re-opens hotlinking and needs a stated reason.
 * `submissions/` imagery is unaffected either way — it is still served from the
 * same-origin `/i/` proxy, which `safeImageSrc` passes through in its
 * leading-slash branch, and admin review's signed URLs are governed by the CSP
 * `img-src` list in `next.config.ts`, not by this one.
 *
 * Empty when `NEXT_PUBLIC_SUPABASE_URL` is unset, which is also why the
 * explicit annotation stays: an empty `as const` array narrows to `never[]`,
 * and the pattern matching below would fail to compile.
 */
export const ALLOWED_IMAGE_HOSTS: readonly string[] = [
  supabaseStorageHost(),
].filter((host): host is string => host !== null)

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
