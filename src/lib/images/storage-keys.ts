/**
 * Bucket-key prefixes and the gates that read them.
 *
 * Deliberately dependency-free. `image-upload.ts` owns the storage CALLS and
 * pulls in the Supabase service client and the image processor with them, so a
 * caller that only needs to ask "is this key mine to delete?" must not have to
 * import that graph — a delete-path gate is exactly the thing a unit test needs
 * to exercise for real rather than mock away.
 */

/** Owner- and admin-managed brand imagery. The only delete-path prefix. */
export const BRAND_IMAGES_KEY_PREFIX = 'brands/'
export const BRAND_IMAGES_BUCKET = 'brand-images' as const
export const BRAND_SUBMISSIONS_BUCKET = 'brand-submissions' as const
export const SUBMISSION_IMAGES_KEY_PREFIX = 'submissions/'

/**
 * Curated product images (DEV-1404): `curated-products/<brand>/<product>/<hash>.webp`.
 *
 * Defined here rather than in `lib/services/image-upload.ts`, which owned it
 * until DEV-1744: `lib/images` must not import `lib/services`, and the URL
 * builder in `image-url.ts` now needs the same prefix. `image-upload.ts`
 * re-exports it, so its existing importers are unchanged.
 */
export const CURATED_PRODUCT_IMAGES_KEY_PREFIX = 'curated-products/'

/** Expo/exhibitor imagery: `event-exhibitors/<event>/<booth>.webp`. */
const EVENT_EXHIBITOR_IMAGES_KEY_PREFIX = 'event-exhibitors/'
const EVENT_IMAGES_KEY_PREFIX = 'events/'

/**
 * Prefixes served straight from the public `brand-images` bucket (DEV-1744).
 *
 * Deliberately an allow-list: an unclassified prefix has no bucket owner and
 * fails closed in uploads, URL generation, maintenance, and the `/i/` proxy.
 * `submissions/` must be absent from this list forever.
 */
const PUBLIC_IMAGE_KEY_PREFIXES = [
  BRAND_IMAGES_KEY_PREFIX,
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  EVENT_EXHIBITOR_IMAGES_KEY_PREFIX,
  EVENT_IMAGES_KEY_PREFIX,
] as const

type ImageStorageBucket =
  | typeof BRAND_IMAGES_BUCKET
  | typeof BRAND_SUBMISSIONS_BUCKET

export type ImageStorageLocation = {
  bucket: ImageStorageBucket
  visibility: 'public' | 'private'
}

function isSafeStorageKey(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('//') &&
    !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

export function resolveImageStorageLocation(
  path: string,
): ImageStorageLocation | null {
  if (!isSafeStorageKey(path)) return null
  if (path.startsWith(SUBMISSION_IMAGES_KEY_PREFIX)) {
    return { bucket: BRAND_SUBMISSIONS_BUCKET, visibility: 'private' }
  }
  if (PUBLIC_IMAGE_KEY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { bucket: BRAND_IMAGES_BUCKET, visibility: 'public' }
  }
  return null
}

export function partitionImageStoragePaths(paths: readonly string[]): {
  [BRAND_IMAGES_BUCKET]: string[]
  [BRAND_SUBMISSIONS_BUCKET]: string[]
  rejected: string[]
} {
  const result = {
    [BRAND_IMAGES_BUCKET]: [] as string[],
    [BRAND_SUBMISSIONS_BUCKET]: [] as string[],
    rejected: [] as string[],
  }

  for (const path of new Set(paths.map((value) => value.trim()).filter(Boolean))) {
    const location = resolveImageStorageLocation(path)
    if (location) result[location.bucket].push(path)
    else result.rejected.push(path)
  }

  return result
}

/** True when a bucket key may be addressed by its public storage URL. */
export function isPublicStorageKey(path: string): boolean {
  return resolveImageStorageLocation(path)?.visibility === 'public'
}

/**
 * True only for brand-owned objects.
 *
 * `deleteStoredImagePaths` also accepts `submissions/` and `curated-products/`,
 * which is right for the flows that own those objects and catastrophic for
 * owner brand-image cleanup: a curated key deleted there takes out a curated
 * product's only object while `curated_products.image_url` still points at it,
 * a loss the storage sweep cannot flag because the reference survives. A caller
 * that must not delete outside `brands/` states that restriction with this
 * predicate, at its own call site.
 */
export function isBrandOwnedStoragePath(path: string): boolean {
  return path.startsWith(BRAND_IMAGES_KEY_PREFIX)
}
