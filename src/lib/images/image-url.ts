import { getSiteUrl } from '@/lib/site-url'

/**
 * Bucket key -> renderable URL (DEV-1551, task 9).
 *
 * Every image we own is addressed by its bucket-relative `storage_path` and
 * served through the same-origin `/i/` proxy (`src/lib/images/image-proxy.ts`).
 * The storage host never appears in a page, so the `brand-images` bucket can be
 * private.
 *
 * RELATIVE IS THE DEFAULT. A relative `src` is what the browser, `next/image`
 * and `metadataBase` all want, and it survives a domain change. Only the two
 * consumers whose output leaves the site — the drip email payload and the
 * link-health checker — call {@link absoluteImageUrl}.
 */

export const IMAGE_PROXY_PATH_PREFIX = '/i/'

/**
 * `brands/<uuid>/x.webp` -> `/i/brands/<uuid>/x.webp`.
 *
 * Returns null for a blank path and for anything that already looks like a URL
 * or an absolute path: those are not bucket keys, and prefixing one would
 * produce a route that 404s while looking plausible in a snapshot.
 */
export function imagePathToUrl(
  storagePath: string | null | undefined,
): string | null {
  const key = storagePath?.trim()
  if (!key) return null
  if (key.startsWith('/') || key.includes('://')) return null
  return `${IMAGE_PROXY_PATH_PREFIX}${key}`
}

/**
 * `/i/brands/x.webp` -> `https://<site>/i/brands/x.webp`.
 *
 * A value that is already absolute is returned unchanged, so a caller holding a
 * mixture of our own paths and third-party URLs can pass the whole list.
 */
export function absoluteImageUrl(url: string | null | undefined): string | null {
  const value = url?.trim()
  if (!value) return null
  if (!value.startsWith('/')) return value
  return `${getSiteUrl()}${value}`
}

/**
 * The inverse of {@link imagePathToUrl}, for the write paths that still have to
 * find a row by the identifier the UI handed back (image removal in the owner
 * dashboard, for one).
 *
 * Only the `/i/` form is recognised. A legacy public storage URL is NOT decoded
 * here: `storageKeyFromPublicUrl` in `image-upload.ts` owns that, and it is
 * deliberately scoped to the delete-safe prefixes.
 */
export function storagePathFromImageUrl(
  url: string | null | undefined,
): string | null {
  const value = url?.trim()
  if (!value || !value.startsWith(IMAGE_PROXY_PATH_PREFIX)) return null
  const key = value.slice(IMAGE_PROXY_PATH_PREFIX.length)
  return key.length > 0 ? key : null
}
