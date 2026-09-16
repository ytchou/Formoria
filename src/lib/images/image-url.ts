import { getSiteUrl } from '@/lib/site-url'
import { isBrandOwnedStoragePath, isPublicStorageKey } from './storage-keys'

/**
 * Bucket key -> renderable URL (DEV-1551, task 9; DEV-1744, task 3).
 *
 * Every image we own is addressed by its bucket-relative `storage_path`.
 * Published imagery (`brands/`, `curated-products/`, `event-exhibitors/`) is
 * addressed by its Supabase public storage URL, so those bytes never cross the
 * Railway origin — the egress this ticket exists to remove. Everything else,
 * `submissions/` above all, still goes through the same-origin `/i/` proxy
 * (`src/lib/images/image-proxy.ts`), which serves it with the service-role key.
 *
 * RELATIVE IS THE DEFAULT. A relative `src` is what the browser, `next/image`
 * and `metadataBase` all want, and it survives a domain change. Only the
 * consumers whose output leaves the site — JSON-LD structured data and the
 * link-health checker — call {@link absoluteImageUrl}.
 */

export const IMAGE_PROXY_PATH_PREFIX = '/i/'

const BRAND_IMAGES_BUCKET = 'brand-images'

/**
 * The public-object segment of a Supabase storage URL for the `brand-images`
 * bucket: `<project>/storage/v1/object/public/brand-images/<key>`.
 *
 * It lives here, in `lib/images`, because this is the ONE seam that turns a
 * bucket key into a public storage URL and back. `lib/services/image-upload.ts`
 * imports it rather than the reverse — services already depend on this module
 * (`storagePathFromImageUrl`), and the dependency only runs that way.
 */
export const BRAND_IMAGES_PUBLIC_URL_SEGMENT = `/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/`

/**
 * The project origin, normalised the SAME way for both directions of this seam.
 *
 * `BRAND_IMAGES_PUBLIC_URL_SEGMENT` already starts with `/`, so an env value
 * ending in one (`https://project.supabase.co/`) would build a double slash —
 * a URL that renders, 404s on the CDN, and no longer matches the prefix the
 * reverse parser builds. Both {@link imagePathToUrl} and
 * {@link storageKeyFromBrandImagesPublicUrl} call this, so the two halves
 * cannot drift apart: one used to trim and the other did not.
 *
 * Returns null when unset, which is what makes both halves fail closed.
 */
function normalizedProjectUrl(): string | null {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/$/,
    '',
  )
  return projectUrl ? projectUrl : null
}

/**
 * `brands/<uuid>/x.webp` -> `<project>/storage/v1/object/public/brand-images/brands/<uuid>/x.webp`,
 * `submissions/<id>/x.webp` -> `/i/submissions/<id>/x.webp`.
 *
 * The branch is DEV-1744's whole fix: a published image is fetched straight
 * from Supabase's storage CDN, and only the prefixes that must stay behind a
 * server-side gate keep paying Railway egress. `PUBLIC_IMAGE_KEY_PREFIXES` is
 * an allow-list on purpose — an unclassified prefix falls through to `/i/`,
 * which is the expensive answer but never the leaking one.
 *
 * It falls back to `/i/` when `NEXT_PUBLIC_SUPABASE_URL` is unset too: a blank
 * origin would yield a same-origin `/storage/v1/...` path that 404s while
 * looking plausible in a snapshot.
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

  if (isPublicStorageKey(key)) {
    const projectUrl = normalizedProjectUrl()
    if (projectUrl) {
      return `${projectUrl}${BRAND_IMAGES_PUBLIC_URL_SEGMENT}${key}`
    }
  }

  return `${IMAGE_PROXY_PATH_PREFIX}${key}`
}

/** `https:`, `data:`, `mailto:` — anything already carrying a URI scheme. */
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

/**
 * `/i/brands/x.webp` -> `https://<site>/i/brands/x.webp`.
 *
 * Idempotent by contract, because JSON-LD callers pass a mixture: a value that
 * already carries a URI scheme (a legacy external image URL) or a
 * protocol-relative `//host/...` is returned unchanged, so passing the result
 * back through changes nothing. A repo-relative value without a leading slash
 * (`images/x.png`) is still ours, so it gets the slash and the origin rather
 * than being handed on as a relative IRI — an IRI Google's structured-data
 * parser drops.
 */
export function absoluteImageUrl(url: string | null | undefined): string | null {
  const value = url?.trim()
  if (!value) return null
  if (URI_SCHEME_PATTERN.test(value) || value.startsWith('//')) return value
  return `${getSiteUrl()}${value.startsWith('/') ? value : `/${value}`}`
}

/**
 * `<project>/storage/v1/object/public/brand-images/<key>` -> `<key>`, with NO
 * key-prefix gate: each caller states its own scope, because they disagree on
 * purpose (delete paths fail closed, read paths fail open — see the DEV-1374
 * note on `storageKeyFromPublicUrlForRead`).
 *
 * Host-exact. A URL naming another project is a different bucket as far as a
 * write path is concerned, and matching it would let a restored-from-elsewhere
 * row drive a deletion here. The `…ForRead` twin in `image-upload.ts` matches
 * on the segment alone precisely because it must not fail closed.
 *
 * Returns null when `NEXT_PUBLIC_SUPABASE_URL` is unset, so a bare
 * `/storage/v1/object/public/brand-images/…` path cannot resolve against an
 * empty origin.
 */
export function storageKeyFromBrandImagesPublicUrl(
  url: string | null | undefined,
): string | null {
  const value = url?.trim()
  if (!value) return null

  const projectUrl = normalizedProjectUrl()
  if (!projectUrl) return null

  const prefix = `${projectUrl}${BRAND_IMAGES_PUBLIC_URL_SEGMENT}`
  if (!value.startsWith(prefix)) return null

  const key = value.slice(prefix.length)
  if (!key || key.includes('..')) return null
  return key
}

/**
 * The inverse of {@link imagePathToUrl}, for the write paths that still have to
 * find a row by the identifier the UI handed back (image removal in the owner
 * dashboard, for one).
 *
 * Two forms are recognised: the `/i/` proxy path DEV-1551 writes, and — for the
 * rows written before that flip, and for whatever the bucket serves directly
 * once it is public again (DEV-1744) — the public storage URL. Recognising both
 * here is what keeps the fix at ONE seam: all five write-path callers go
 * through this function, so none of them needs a second branch of its own.
 *
 * The public branch stays scoped to `brands/`. `rejectBrandImages` deletes
 * every key this resolves, so a `curated-products/` or `submissions/` object
 * reaching it would be removed while its own row still points at it — the
 * DEV-1374 asymmetry. A signed URL is not decoded here either: its key sits
 * behind an `/object/sign/` segment and a token, and no write path needs it.
 */
export function storagePathFromImageUrl(
  url: string | null | undefined,
): string | null {
  const value = url?.trim()
  if (!value) return null

  if (value.startsWith(IMAGE_PROXY_PATH_PREFIX)) {
    const key = value.slice(IMAGE_PROXY_PATH_PREFIX.length)
    return key.length > 0 ? key : null
  }

  const publicKey = storageKeyFromBrandImagesPublicUrl(value)
  return publicKey && isBrandOwnedStoragePath(publicKey) ? publicKey : null
}
