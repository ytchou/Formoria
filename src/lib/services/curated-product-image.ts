import crypto from "node:crypto";

import { auditedCall } from "@/lib/audit";
import {
  DEFAULT_CONFIG,
  processImage,
  type ProcessedImage,
} from "@/lib/security/image-processor";
import { isPrivateUrl } from "@/lib/services/enrich-phases/scraper/fetch-guards";
import {
  CURATED_PRODUCT_IMAGES_KEY_PREFIX,
  curatedProductStorageKeyFromPublicUrl,
  deleteStoredImagePaths,
  uploadPublicImage,
} from "@/lib/services/image-upload";

/**
 * Curated-product image storage (DEV-1465).
 *
 * THE KEY SHAPE IS LOAD-BEARING:
 *   curated-products/<brand-id>/<product-id>/<sha256(image_source_url)>.webp
 *
 * `scripts/remove-brand.ts` and `STORAGE_KEY_PREFIXES` / `buildReferenceSet` in
 * `scripts/brand-storage-maintenance.ts` both derive references from exactly
 * this shape. Deviate and the maintenance sweep classifies these objects as
 * untracked and purges them after the soak window — and its
 * `expectedUntracked` tolerance is tight enough that a burst of abandoned
 * uploads trips it. Which is why this runs ON SAVE, never on file selection: an
 * abandoned editor form must leave no object behind at all.
 */

/** Long enough for a slow origin, short enough not to hang an editor's save. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * The cap is `processImage`'s own limit, imported rather than re-typed: a
 * download bound larger than what the processor accepts only buys the fetch the
 * right to burn memory on bytes that are then rejected.
 */
const MAX_IMAGE_BYTES = DEFAULT_CONFIG.maxFileSizeBytes;

/**
 * The content types whose bytes `processImage` is willing to decode
 * (jpeg/png/webp). Checked BEFORE the body is read so an HTML error page or a
 * multi-gigabyte video served from an image URL costs one header read.
 */
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function isAllowedImageContentType(header: string | null): boolean {
  if (!header) return false;
  return ALLOWED_IMAGE_CONTENT_TYPES.has(
    header.split(";")[0]!.trim().toLowerCase(),
  );
}

/**
 * Reads the body with a hard byte ceiling, streaming rather than buffering.
 *
 * Exported because the dimension backfill
 * (`scripts/curated-products/backfill-image-dimensions.ts`) reads stored objects
 * too and must not grow a second capped-read implementation that drifts from
 * this one.
 *
 * `Buffer.from(await response.arrayBuffer())` allocates whatever the origin
 * chooses to send before anything can object, so a hostile or broken origin
 * decides this process's memory. `content-length` is checked when present and
 * the stream is cancelled the moment the running total crosses the cap —
 * because a chunked response carries no length at all.
 */
export async function readImageBodyCapped(response: Response): Promise<Buffer> {
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `The image is too large (${declaredLength} bytes); the maximum is ${MAX_IMAGE_BYTES}`,
    );
  }

  const body = response.body;
  if (!body) {
    // A mocked `new Response(bytes)` in a unit test still exposes a body; a
    // genuinely bodyless 200 has no image in it either way.
    throw new Error("The image response carried no body");
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        throw new Error(
          `The image is too large; the maximum is ${MAX_IMAGE_BYTES} bytes`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Releases the socket on the oversize path instead of draining the rest.
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks);
}

export type CuratedProductImageInput = {
  brandId: string;
  productId: string;
  /** The page-published image URL an editor confirmed. */
  imageSourceUrl: string;
  /** The public URL currently stored on the row, if any. */
  previousImageUrl?: string | null;
};

/**
 * What the stored object is, for the row that points at it.
 *
 * `width`/`height` are the POST-rotate, POST-resize dimensions `processImage`
 * reports, because the resized object is what a browser downloads and what the
 * homepage wall renders at its native ratio (DEV-1479).
 */
export type StoredCuratedProductImage = {
  url: string;
  width: number;
  height: number;
};

/**
 * Injectable storage seam. Tests drive the upload without a bucket, and
 * `scripts/check-test-boundaries.mjs` forbids mocking the module instead.
 */
export type CuratedProductImageDeps = {
  upload?: typeof uploadPublicImage;
  deletePaths?: typeof deleteStoredImagePaths;
};

/** Module-private: the key shape is derived here and nowhere else. */
function curatedProductImageKey(input: {
  brandId: string;
  productId: string;
  imageSourceUrl: string;
}): string {
  const hash = crypto
    .createHash("sha256")
    .update(input.imageSourceUrl)
    .digest("hex");
  return `${CURATED_PRODUCT_IMAGES_KEY_PREFIX}${input.brandId}/${input.productId}/${hash}.webp`;
}

/**
 * Downloads and normalizes one image, writing NOTHING.
 *
 * SSRF GUARD, same shape as `enrich-phases/scraper/fetch-guards.ts`: this URL
 * is typed by a human into an admin form and fetched by the server, so without
 * the check it is a request forger against the deployment's own network. The
 * private-URL test runs twice — once on the input and once on `response.url`,
 * because redirects are followed by default and the input check says nothing
 * about where the bytes came from. The guarded form (`response.url &&
 * response.url !== url`) is the scraper's: a mocked `new Response(body)` has
 * `url === ''`, and `isPrivateUrl('')` fails closed.
 *
 * `processImage` THROWS on GIF and SVG (its format allowlist is jpeg/png/webp),
 * on anything over 5 MB, and on undecodable bytes. That throw is propagated
 * deliberately, as is every rejection above: the caller surfaces them as a
 * FIELD error on the image URL, since "this image cannot be used" is a fact
 * about the value the editor typed, not an internal failure to swallow.
 *
 * SPLIT FROM THE UPLOAD ON PURPOSE: every fallible external step lives here and
 * needs no product id, so a create path can run it BEFORE inserting a row and
 * leave nothing behind when the image is rejected.
 */
export async function prepareCuratedProductImage(
  imageSourceUrl: string,
  subjectId?: string,
): Promise<ProcessedImage> {
  // The fetch is audited on its own span (`http.fetch_curated_image`) so
  // the bytes stored against a product trace back to the exact request.
  const buffer = await auditedCall(
    {
      provider: "http",
      operation: "fetch_curated_image",
      kind: "external",
    },
    async () => {
      if (isPrivateUrl(imageSourceUrl)) {
        throw new Error("That image URL is not reachable from this server");
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        IMAGE_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch(imageSourceUrl, {
          signal: controller.signal,
          headers: { Accept: "image/*" },
        });
        if (
          response.url &&
          response.url !== imageSourceUrl &&
          isPrivateUrl(response.url)
        ) {
          throw new Error("That image URL redirects somewhere unreachable");
        }
        if (!response.ok) {
          throw new Error(
            `Could not download the image (HTTP ${response.status})`,
          );
        }
        if (!isAllowedImageContentType(response.headers.get("content-type"))) {
          throw new Error(
            `That URL did not serve an image (content-type ${
              response.headers.get("content-type") ?? "missing"
            })`,
          );
        }
        return await readImageBodyCapped(response);
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { subjectId },
  );

  return processImage(buffer);
}

/**
 * Stores already-processed bytes and returns the public URL for the row.
 *
 * ORDERING: the previous object is deleted only AFTER the new upload succeeds.
 * A crash between the two must leave a stale object — which the storage sweep
 * can find and reclaim — rather than a row pointing at nothing, which nothing
 * can repair.
 *
 * `image_usage` is NOT touched here. A successful download is not consent; only
 * a human may assert usage rights.
 */
export async function uploadCuratedProductImage(
  input: CuratedProductImageInput & { processed: ProcessedImage },
  deps: CuratedProductImageDeps = {},
): Promise<StoredCuratedProductImage> {
  return auditedCall(
    {
      provider: "images",
      operation: "storeCuratedProductImage",
      kind: "service",
    },
    async () => {
      const processed = input.processed;
      const path = curatedProductImageKey(input);
      // `upsert: true` is safe here and only here: the path is DERIVED from the
      // source URL, so re-saving the same source overwrites in place instead of
      // orphaning an object on every apply.
      const upload = deps.upload ?? uploadPublicImage;
      const { url } = await upload({
        bucket: "brand-images",
        path,
        data: processed.buffer,
        contentType: processed.contentType,
        upsert: true,
      });

      const previousKey = input.previousImageUrl
        ? curatedProductStorageKeyFromPublicUrl(input.previousImageUrl)
        : null;
      if (previousKey && previousKey !== path) {
        // Best effort: the row already points at the new object, so a failed
        // cleanup leaves a stale object for the storage sweep, not a broken row.
        try {
          await (deps.deletePaths ?? deleteStoredImagePaths)([previousKey]);
        } catch (error) {
          console.error(
            "[curatedProducts] stale image cleanup failed",
            previousKey,
            error,
          );
        }
      }

      return { url, width: processed.width, height: processed.height };
    },
    { subjectId: input.productId },
  );
}

/**
 * Downloads, normalizes, and stores one curated-product image in one call,
 * returning the public URL to write onto the row. The update path uses this:
 * the row already exists, so nothing is left behind when the image is rejected.
 */
export async function storeCuratedProductImage(
  input: CuratedProductImageInput,
  deps: CuratedProductImageDeps = {},
): Promise<StoredCuratedProductImage> {
  const processed = await prepareCuratedProductImage(
    input.imageSourceUrl,
    input.productId,
  );
  return uploadCuratedProductImage({ ...input, processed }, deps);
}
