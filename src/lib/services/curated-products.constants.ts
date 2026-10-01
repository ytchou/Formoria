/**
 * Split out of curated-products.ts so the client BrandCard can read the cap
 * without importing the service itself — same reason as
 * community-submissions.constants.ts: the service is audit-instrumented, so a
 * VALUE import from it pulls src/lib/audit -> node:async_hooks into the client
 * bundle (a Turbopack build failure). Type-only imports stay safe.
 */
export const PREVIEW_THUMBNAIL_LIMIT = 3;

/**
 * The most product thumbnails a trail card peeks under its band. Shared by the
 * client TrailTile and the service read for the same bundle reason as above.
 */
export const TRAIL_PEEK_SIZE = 4;
