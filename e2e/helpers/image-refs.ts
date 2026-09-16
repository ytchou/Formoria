/**
 * Image references for seeds, DEV-1744 edition.
 *
 * The `brand-images` bucket is public again, and the two prefix families are
 * served differently: a published key (`brands/`, `curated-products/`,
 * `event-exhibitors/`) renders as a Supabase public storage URL, while
 * `submissions/` — pre-moderation content — still renders as the same-origin
 * `/i/<key>` proxy path and is refused by that route for anyone but a signed
 * URL holder. Rows are seeded by their bucket key (`storage_path`); anything
 * that needs a renderable value derives it here, exactly as the services do.
 *
 * `/i/<key>` remains a VALID stored reference for a `brands/` key — that is the
 * form DEV-1551 wrote into existing rows, and `storagePathFromImageUrl` still
 * resolves it — so `e2eProxyImageUrl` stays, now meaning "the proxy form"
 * rather than "the rendered form".
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
