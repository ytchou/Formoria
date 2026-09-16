/**
 * Same-origin image proxy (DEV-1551, task 7).
 *
 * Brand imagery is served from `/i/<bucket-relative-path>` instead of the
 * public Supabase object URL, so the storage host never appears in a page and
 * the bucket can stop being public. The bytes are streamed through the origin;
 * no Supabase image render/transform endpoint is involved (that endpoint is a
 * separately metered line item, and `scripts/check-storage-transforms.mjs`
 * fails the lint chain on it).
 *
 * Everything here is pure except `serveProxiedImage`, whose only side effects
 * are the injected `download` and `info` calls — the route owns constructing
 * the real storage client, this module owns the allow-list, the traversal
 * rejection, the conditional-GET handling and the response headers.
 */

export const PROXIED_IMAGE_BUCKET = "brand-images" as const;

/**
 * Key prefixes this route refuses to serve. A DENY-list, not an allow-list.
 *
 * `submissions/` is pre-moderation content that only admins may see; admin
 * review signs its URLs instead (`src/lib/services/_shared/signed-urls.ts`).
 * Everything else in `brand-images` is public imagery, which is the invariant
 * this constant now states directly.
 *
 * It used to be an allow-list and it went stale twice in one week: task 11
 * missed `curated-products/`, which would have 404ed every curated product
 * image the moment the bucket went private, and the 2026-08-23 staging
 * backfill then turned up `events/`, which no list knew about at all. An
 * allow-list has to be edited every time a surface stores a new prefix, and
 * nothing fails until production 404s -- `resolveProxiedImageKey` returning
 * null is indistinguishable from a genuinely bad key. A deny-list cannot go
 * stale as surfaces are added, and the one thing that must stay private is
 * named explicitly.
 *
 * Adding a prefix here makes objects PRIVATE. Anything added must have a
 * signed-URL path for the people who are allowed to see it.
 */
export const PRIVATE_IMAGE_PREFIXES = ["submissions/"] as const;

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
 * raw REST payload and older rows use `last_modified`/`updated_at`.
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

/** Strips a weak-validator prefix and surrounding quotes for comparison. */
function normalizeValidator(value: string): string {
  const unweighted = value.trim().replace(/^W\//i, "");
  return unweighted.replace(/^"([\s\S]*)"$/, "$1");
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

  const etag = info.etag?.trim();
  if (etag) return `"${normalizeValidator(etag)}"`;

  const version = info.version?.trim();
  if (version) return `"${normalizeValidator(version)}"`;

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
  if (PRIVATE_IMAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
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

/** 304 carries no body, so it carries no content type either. */
function notModifiedHeaders(etag: string): Headers {
  return new Headers({
    "cache-control": PROXIED_IMAGE_CACHE_CONTROL,
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
