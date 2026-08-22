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
 * Everything here is pure except `serveProxiedImage`, whose only side effect is
 * the injected `download` call — the route owns constructing the real storage
 * client, this module owns the allow-list, the traversal rejection and the
 * response headers.
 */

export const PROXIED_IMAGE_BUCKET = "brand-images" as const;

/**
 * The ONLY key prefixes this route will serve. A module-level constant rather
 * than an inline conditional so that adding a prefix is a visible, reviewable
 * diff.
 *
 * `submissions/` is deliberately absent: submission imagery is pre-moderation
 * content that only admins may see, and admin review signs its URLs instead
 * (see `src/lib/services/_shared/signed-urls.ts`). `curated-products/` is
 * absent because nothing renders it through this route yet — add it with its
 * own test when something does.
 */
export const PROXIED_IMAGE_PREFIXES = [
  "brands/",
  "event-exhibitors/",
] as const;

export const PROXIED_IMAGE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

export type ProxiedImageDownload = (key: string) => Promise<{
  data: Blob | null;
  error: unknown;
}>;

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
  if (!PROXIED_IMAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return null;
  }

  return key;
}

export function proxiedImageHeaders(contentType: string | null): Headers {
  return new Headers({
    "content-type": contentType?.trim() || FALLBACK_CONTENT_TYPE,
    "cache-control": PROXIED_IMAGE_CACHE_CONTROL,
    // The content type is whatever the object was stored with; refusing to
    // sniff keeps a mislabelled object from being interpreted as markup.
    "x-content-type-options": "nosniff",
  });
}

export async function serveProxiedImage(
  segments: readonly string[] | undefined,
  download: ProxiedImageDownload,
): Promise<Response> {
  const key = resolveProxiedImageKey(segments);
  if (!key) return new Response(null, { status: 404 });

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
    headers: proxiedImageHeaders(data.type),
  });
}
