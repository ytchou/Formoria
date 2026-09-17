/**
 * Image references for seeds, DEV-1744 edition.
 *
 * The `brand-images` bucket is private again (DEV-1744 task 3's public-URL
 * branch was descoped — see `src/lib/images/image-url.ts`'s docblock: a
 * public bucket has no per-prefix RLS, so it exposed `submissions/` for the
 * whole upload-to-approval window, confirmed live against staging
 * 2026-09-17). Every prefix, `brands/` included, renders via the same-origin
 * `/i/<key>` proxy path again. Rows are seeded by their bucket key
 * (`storage_path`); anything that needs a renderable value derives it here,
 * exactly as the services do.
 *
 * `e2ePublicImageUrl` stays: it is the regression guard for the eventual
 * bucket-separation follow-up, asserted against the raw Supabase URL
 * independent of which URL shape the app currently renders.
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
export function e2ePublicImageUrl(storagePath: string): string {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required to build a public image URL");
  }
  return `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/brand-images/${storagePath}`;
}
