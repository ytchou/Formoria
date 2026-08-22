/**
 * Image references for seeds, DEV-1551 edition.
 *
 * The `brand-images` bucket is private, so a public storage URL is a dead link
 * and no seed may build one. Rows are seeded by their bucket key
 * (`storage_path`); anything that needs a renderable value derives `/i/<key>`
 * from it, exactly as the services do.
 *
 * Deliberately duplicated rather than imported from `src/lib/images/image-url`:
 * the e2e suite asserts the CONTRACT, and a helper shared with the code under
 * test would make a wrong prefix pass on both sides at once.
 */

/** Bucket key for a seeded brand image. Must stay under an `/i/`-served prefix. */
export function e2eBrandImageKey(brandId: string, name: string): string {
  return `brands/${brandId}/${name}`;
}

/** Bucket key for a seeded submission image. `/i/` deliberately 404s these. */
export function e2eSubmissionImageKey(
  submissionId: string,
  name: string,
): string {
  return `submissions/${submissionId}/${name}`;
}

/** The same-origin path the app renders for a bucket key. */
export function e2eProxyImageUrl(storagePath: string): string {
  return `/i/${storagePath}`;
}
