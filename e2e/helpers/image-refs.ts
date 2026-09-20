/**
 * Image references for seeds after the DEV-1746 bucket split.
 *
 * Published prefixes live in public `brand-images`; `submissions/` lives in
 * permanently private `brand-submissions`. Rows still store bucket-relative
 * keys, so helpers take the bucket only when constructing a raw storage URL.
 *
 * Deliberately duplicated rather than imported from `src/lib/images/image-url`:
 * the e2e suite asserts the CONTRACT, and a helper shared with the code under
 * test would make a wrong prefix pass on both sides at once.
 */

/** Bucket key for a seeded brand image. A publicly-served prefix. */
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

/** The same-origin proxy path for a bucket key. */
export function e2eProxyImageUrl(storagePath: string): string {
  return `/i/${storagePath}`;
}

/**
 * The Supabase public storage URL for a bucket key — what the app renders for a
 * published prefix, and what must NOT resolve for a `submissions/` key.
 */
export function e2ePublicImageUrl(
  storagePath: string,
  bucket = "brand-images",
): string {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required to build a public image URL");
  }
  return `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${storagePath}`;
}
