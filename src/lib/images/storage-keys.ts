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
export const EVENT_EXHIBITOR_IMAGES_KEY_PREFIX = 'event-exhibitors/'

/**
 * Prefixes served straight from the public `brand-images` bucket (DEV-1744).
 *
 * The positive twin of `PRIVATE_IMAGE_PREFIXES` in `image-proxy.ts`, and
 * deliberately an ALLOW-list: a key under a prefix nobody has classified yet
 * keeps routing through `/i/`, which costs egress but cannot leak. The deny-list
 * in `image-proxy.ts` stays as it is — it guards the proxy, this guards the URL
 * builder, and `submissions/` must be absent from this list forever.
 */
export const PUBLIC_IMAGE_KEY_PREFIXES = [
  BRAND_IMAGES_KEY_PREFIX,
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  EVENT_EXHIBITOR_IMAGES_KEY_PREFIX,
] as const

/** True when a bucket key may be addressed by its public storage URL. */
export function isPublicStorageKey(path: string): boolean {
  return PUBLIC_IMAGE_KEY_PREFIXES.some((prefix) => path.startsWith(prefix))
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
