/**
 * Same-origin image proxy (DEV-1551, task 7).
 *
 * `/i/<bucket-relative-path>` remains a compatibility and defense-in-depth
 * route for published imagery. The bytes are streamed through the origin; no
 * Supabase image render/transform endpoint is involved (that endpoint is a
 * separately metered line item, and `scripts/check-storage-transforms.mjs`
 * fails the lint chain on it).
 *
 * Everything here is pure except `serveProxiedImage`, whose only side effects
 * are the injected `download` and `info` calls — the route owns constructing
 * the real storage client, this module owns the allow-list, the traversal
 * rejection, the conditional-GET handling and the response headers.
 */

import {
  BRAND_IMAGES_BUCKET,
  resolveImageStorageLocation,
} from "./storage-keys";

export const PROXIED_IMAGE_BUCKET = BRAND_IMAGES_BUCKET;

const PROXIED_IMAGE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

export type ProxiedImageDownload = (key: string) => Promise<{
  data: Blob | null;
  error: unknown;
}>;

/**
 * The subset of Supabase's object-info payload this module reads. Both casings
 * are accepted because the storage client camelizes (`lastModified`) while the
 * raw REST payload and older rows use `last_modified`/`updated_at`
 * (`FileObjectV2` in `@supabase/storage-js`, where `updated_at` is the
 * deprecated predecessor of `last_modified`).
 *
 * The snake_case members are a DELIBERATE, scoped exception to the repo's
 * "TypeScript types are camelCase" convention (CLAUDE.md, Data Conventions).
 * That rule governs internal data models, which are transformed at the service
 * boundary; this type is not one. It describes an EXTERNAL SDK response at the
 * point it is read, and `info` is an injectable seam — a caller wiring the raw
 * REST payload instead of the camelizing client is exactly the case the second
 * casing covers. Renaming these fields would silently stop matching the payload
 * rather than fail to compile. Nothing downstream sees this shape:
 * `deriveProxiedImageETag` collapses it to a single string.
 */
export type ProxiedImageObjectInfo = {
  etag?: string | null;
  version?: string | null;
  size?: number | null;
  lastModified?: string | null;
  last_modified?: string | null;
  updated_at?: string | null;
};

/**
 * Metadata seam, mirroring `download`'s shape. Separate from `download`
 * because `StorageFileApi.download` resolves to `{ data: Blob, error }` and
 * exposes no response headers at all — there is no etag or last-modified to
 * harvest from the byte fetch, so conditional support needs its own call.
 *
 * It is a second round trip, but only ever a metadata-sized one, and it runs
 * BEFORE the download: a matching `If-None-Match` skips the object fetch
 * entirely, which is the byte transfer this whole ticket exists to remove.
 */
export type ProxiedImageInfo = (key: string) => Promise<{
  data: ProxiedImageObjectInfo | null;
  error: unknown;
}>;

export type ServeProxiedImageOptions = {
  /** Raw `If-None-Match` request header, or null when absent. */
  ifNoneMatch?: string | null;
  /**
   * Omitted (in tests and any caller that does not care) means no ETag is
   * emitted and no conditional handling happens — the pre-DEV-1744 behaviour.
   */
  info?: ProxiedImageInfo;
};

/**
 * Strips a weak-validator prefix and surrounding quotes for comparison, or
 * returns null when the result cannot be used as a validator.
 *
 * The quote strip is outermost-only, so a value carrying an INTERIOR `"` would
 * survive it and be re-wrapped into a malformed `ETag` header (and compared
 * against a header that was parsed differently). Supabase Storage etags are hex
 * MD5 hashes, so this is unreachable today; the null is the cheap guard that
 * keeps it unreachable — an unusable validator drops the ETag rather than
 * emitting a broken one, which degrades to the pre-DEV-1744 behaviour.
 */
function normalizeValidator(value: string): string | null {
  const unweighted = value.trim().replace(/^W\//i, "");
  const unquoted = unweighted.replace(/^"([\s\S]*)"$/, "$1");
  return unquoted.includes('"') ? null : unquoted;
}

/**
 * Builds the ETag this route serves, or null when the object carries nothing
 * stable to build one from. Pure — the caller owns fetching the metadata.
 *
 * Preference order is strongest-first: the storage etag, then the object
 * version, then size + last-modified. The fallback shares
 * `statBrandImageObject`'s ceiling (size-only identity cannot tell two
 * equal-sized objects apart) but pairs it with a timestamp, so a re-upload at
 * the same size still invalidates.
 */
export function deriveProxiedImageETag(
  info: ProxiedImageObjectInfo | null,
): string | null {
  if (!info) return null;

  // An unusable candidate (interior quote) falls through to the next one rather
  // than aborting the chain: a weaker ETag still beats none.
  const rawEtag = info.etag?.trim();
  const etag = rawEtag ? normalizeValidator(rawEtag) : null;
  if (etag) return `"${etag}"`;

  const rawVersion = info.version?.trim();
  const version = rawVersion ? normalizeValidator(rawVersion) : null;
  if (version) return `"${version}"`;

  const modified = info.lastModified ?? info.last_modified ?? info.updated_at;
  const modifiedAt = modified ? Date.parse(modified) : Number.NaN;
  if (
    typeof info.size === "number" &&
    Number.isFinite(info.size) &&
    Number.isFinite(modifiedAt)
  ) {
    return `"${info.size}-${modifiedAt}"`;
  }

  return null;
}

/**
 * RFC 9110 §13.1.2: `*` matches any current representation, the list is
 * comma-separated, and the comparison is weak (`W/` is ignored).
 */
export function ifNoneMatchSatisfied(
  ifNoneMatch: string | null | undefined,
  etag: string | null,
): boolean {
  if (!ifNoneMatch || !etag) return false;

  const wanted = normalizeValidator(etag);
  if (wanted === null) return false;

  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .some(
      (candidate) =>
        candidate === "*" || normalizeValidator(candidate) === wanted,
    );
}

/**
 * Never throws and never 404s on its own: metadata is an optimisation, so a
 * failing or absent info call degrades to "no ETag", not to a failed request.
 */
async function readProxiedImageETag(
  key: string,
  info: ProxiedImageInfo,
): Promise<string | null> {
  try {
    const { data, error } = await info(key);
    if (error || !data) return null;
    return deriveProxiedImageETag(data);
  } catch {
    return null;
  }
}

/**
 * Percent-decoding is applied until the value stops changing, so `%252e%252e`
 * cannot survive a single decode and reappear as `..` inside the storage key.
 * Ceiling: a key containing a literal `%` would be rewritten by this loop.
 * Every key we generate is `<prefix>/<uuid-or-hash>.<ext>`, so none can; if
 * that ever stops being true, decode exactly once and reject a residual `%`.
 */
function fullyDecode(value: string): string | null {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed escape: unusable as a key either way.
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  // Still changing after four passes is not a real key.
  return null;
}

/**
 * Turns the catch-all route segments into a bucket-relative key, or null when
 * the request must 404. Normalisation and traversal rejection happen BEFORE the
 * allow-list check, so a `brands/../submissions/x.webp` cannot enter through
 * an allow-listed prefix.
 */
export function resolveProxiedImageKey(
  segments: readonly string[] | undefined,
): string | null {
  if (!segments || segments.length === 0) return null;

  const decoded = fullyDecode(segments.join("/"));
  if (!decoded) return null;

  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    decoded.includes("//")
  ) {
    return null;
  }

  const parts = decoded.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  // Belt and braces: catches `..` fused into a segment such as `a..%2fb`
  // after decoding.
  if (decoded.includes("..")) return null;

  const key = parts.join("/");
  const location = resolveImageStorageLocation(key);
  if (!location || location.bucket !== PROXIED_IMAGE_BUCKET) {
    return null;
  }

  return key;
}

function proxiedImageHeaders(
  contentType: string | null,
  etag: string | null,
): Headers {
  const headers = new Headers({
    "content-type": contentType?.trim() || FALLBACK_CONTENT_TYPE,
    "cache-control": PROXIED_IMAGE_CACHE_CONTROL,
    // The content type is whatever the object was stored with; refusing to
    // sniff keeps a mislabelled object from being interpreted as markup.
    "x-content-type-options": "nosniff",
  });
  if (etag) headers.set("etag", etag);
  return headers;
}

/**
 * 304 carries no body, so it carries no content type either.
 *
 * `nosniff` is repeated here even though the 304 has nothing to sniff: RFC 9111
 * §3.2 lets a cache replace the stored response's headers with the ones on the
 * 304, so omitting it would strip the protection off the cached 200 after the
 * first successful revalidation.
 */
function notModifiedHeaders(etag: string): Headers {
  return new Headers({
    "cache-control": PROXIED_IMAGE_CACHE_CONTROL,
    "x-content-type-options": "nosniff",
    etag,
  });
}

export async function serveProxiedImage(
  segments: readonly string[] | undefined,
  download: ProxiedImageDownload,
  options: ServeProxiedImageOptions = {},
): Promise<Response> {
  const key = resolveProxiedImageKey(segments);
  if (!key) return new Response(null, { status: 404 });

  // Metadata BEFORE bytes, deliberately: this ordering is what lets a matching
  // `If-None-Match` skip the download entirely. Accepted trade-off — an object
  // replaced between the two calls serves the new bytes under the old ETag,
  // which the client's next revalidation corrects at the cost of one extra
  // transfer. No stale bytes are ever served, so this is cheaper than fetching
  // the object first and re-reading its metadata.
  const etag = options.info
    ? await readProxiedImageETag(key, options.info)
    : null;

  if (etag && ifNoneMatchSatisfied(options.ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: notModifiedHeaders(etag) });
  }

  let data: Blob | null = null;
  let error: unknown = null;
  try {
    ({ data, error } = await download(key));
  } catch (caught) {
    error = caught;
  }

  if (error || !data) {
    return new Response(null, { status: 404 });
  }

  return new Response(data, {
    status: 200,
    headers: proxiedImageHeaders(data.type, etag),
  });
}
