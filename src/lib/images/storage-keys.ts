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
