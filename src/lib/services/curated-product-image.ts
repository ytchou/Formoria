import crypto from "node:crypto";

import { auditedCall } from "@/lib/audit";
import {
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
import { imagePathToUrl } from "@/lib/images/image-url";
import {
  findImageRejectionReasons,
  type ImageTextSignals,
} from "@/lib/curated-products/commerce-text";
import { readImageSignals } from "@/lib/services/image-text";

/**
 * Curated-product image storage (DEV-1465).
 *
 * THE KEY SHAPE IS LOAD-BEARING:
 *   curated-products/<brand-id>/<product-id>/<sha256(image_source_url)>.webp
 *
 * `scripts/remove-brand.ts` and `STORAGE_KEY_PREFIXES` / `buildReferenceSet` in
 * `scripts/enrichment/images/brand-storage-maintenance.ts` both derive references from exactly
 * this shape. Deviate and the maintenance sweep classifies these objects as
 * untracked and purges them after the soak window — and its
 * `expectedUntracked` tolerance is tight enough that a burst of abandoned
 * uploads trips it. Which is why this runs ON SAVE, never on file selection: an
 * abandoned editor form must leave no object behind at all.
 */

/** Long enough for a slow origin, short enough not to hang an editor's save. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/** Matches the `brand-images` bucket limit while keeping other upload paths at 5 MiB. */
const MAX_CURATED_PRODUCT_SOURCE_BYTES = 10 * 1024 * 1024;

class ImageSourceRejection extends Error {
  constructor(
    message: string,
    readonly reason:
      "missing_image" | "unsupported_content_type" | "source_too_large",
  ) {
    super(message);
  }
}

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
 * (`scripts/enrichment/products/curated-products/backfill-image-dimensions.ts`) reads stored objects
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
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CURATED_PRODUCT_SOURCE_BYTES
  ) {
    throw new ImageSourceRejection(
      `The image is too large (${declaredLength} bytes); the maximum is ${MAX_CURATED_PRODUCT_SOURCE_BYTES}`,
      "source_too_large",
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
      if (total > MAX_CURATED_PRODUCT_SOURCE_BYTES) {
        throw new ImageSourceRejection(
          `The image is too large; the maximum is ${MAX_CURATED_PRODUCT_SOURCE_BYTES} bytes`,
          "source_too_large",
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
 * Reads the visible text and ad-creative signals off a processed image;
 * production is `readImageSignals`.
 */
type CuratedProductImageSignalsReader = (
  processed: ProcessedImage,
) => Promise<ImageTextSignals>;

/**
 * Injectable storage and text-reader seams. Tests drive the upload without a
 * bucket and the commerce-truth gate without OpenAI, and
 * `scripts/check-test-boundaries.mjs` forbids mocking the module instead.
 */
export type CuratedProductImageDeps = {
  upload?: typeof uploadPublicImage;
  deletePaths?: typeof deleteStoredImagePaths;
  readSignals?: CuratedProductImageSignalsReader;
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
 * on anything over this flow's 10 MiB source cap, and on undecodable bytes.
 * That throw is propagated deliberately, as is every rejection above: the
 * caller surfaces them as a FIELD error on the image URL, since "this image
 * cannot be used" is a fact about the value the editor typed, not an internal
 * failure to swallow.
 *
 * SPLIT FROM THE UPLOAD ON PURPOSE: every fallible external step lives here and
 * needs no product id, so a create path can run it BEFORE inserting a row and
 * leave nothing behind when the image is rejected.
 *
 * COMMERCE-TRUTH GATE (DEV-1962): Formoria never stores price, discount or
 * promotion, so an image whose visible text carries a commerce marker
 * (`findCommerceTruthText`) is rejected like any other unusable image. It
 * FAILS CLOSED: when the text cannot be read the image is rejected too. In the
 * editor that is a retry; in a refresh mirror it leaves the row imageless —
 * and so hidden — until the next refresh retries it, which is self-healing.
 * Letting an unread image through would make every OpenAI outage a window
 * for promo banners.
 *
 * AD-CREATIVE GATE (DEV-1989): the same read reports whether a person presents
 * the product and how much of the image is overlaid text, and
 * `findImageRejectionReasons` rejects a spokesperson ad, a banner or ad copy
 * (「一件可印」) the same way, failing closed the same way.
 */
export async function prepareCuratedProductImage(
  imageSourceUrl: string,
  subjectId?: string,
  deps: Pick<CuratedProductImageDeps, "readSignals"> = {},
): Promise<ProcessedImage> {
  // The fetch is audited on its own span (`http.fetch_curated_image`) so
  // the bytes stored against a product trace back to the exact request.
  const buffer = await auditedCall(
    {
      provider: "http",
      operation: "fetch_curated_image",
      kind: "external",
      meta: { url: imageSourceUrl, method: "GET" },
    },
    async (ctx) => {
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
        ctx.summary.status = response.status;
        ctx.summary.contentType = response.headers.get("content-type");
        ctx.summary.resolvedUrl = response.url || imageSourceUrl;
        ctx.summary.contentLength = response.headers.get("content-length");
        if (
          response.url &&
          response.url !== imageSourceUrl &&
          isPrivateUrl(response.url)
        ) {
          throw new Error("That image URL redirects somewhere unreachable");
        }
        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            throw new ImageSourceRejection(
              `Could not download the image (HTTP ${response.status})`,
              "missing_image",
            );
          }
          throw new Error(
            `Could not download the image (HTTP ${response.status})`,
          );
        }
        if (!isAllowedImageContentType(response.headers.get("content-type"))) {
          throw new ImageSourceRejection(
            `That URL did not serve an image (content-type ${
              response.headers.get("content-type") ?? "missing"
            })`,
            "unsupported_content_type",
          );
        }
        const bytes = await readImageBodyCapped(response);
        ctx.summary.byteLength = bytes.length;
        return bytes;
      } catch (error) {
        if (!(error instanceof ImageSourceRejection)) throw error;
        ctx.summary.rejectionReason = error.reason;
        ctx.summary.error = error.message;
        return error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      subjectId,
      classify: (result) =>
        result instanceof ImageSourceRejection ? "empty" : "succeeded",
    },
  );

  // An unusable candidate is an empty fetch outcome, but remains a field error.
  if (buffer instanceof ImageSourceRejection) throw buffer;

  const processed = await processImage(buffer, {
    maxFileSizeBytes: MAX_CURATED_PRODUCT_SOURCE_BYTES,
  });

  // The PROCESSED bytes are read because they are what gets stored and shown.
  const readSignals =
    deps.readSignals ??
    ((image: ProcessedImage) => readImageSignals(image, { subjectId }));
  let signals: ImageTextSignals;
  try {
    signals = await readSignals(processed);
  } catch (error) {
    console.error("[curatedProducts] image text read failed", error);
    throw new Error(
      "Could not check the image for prices or promotions; try again",
    );
  }
  const { commerce, adCreative } = findImageRejectionReasons(signals);
  if (commerce.length > 0) {
    throw new Error(
      `The image shows prices or promotions (${commerce.join(", ")}); choose a clean product photo`,
    );
  }
  if (adCreative.length > 0) {
    throw new Error(
      `The image is an advertisement (${adCreative.join(", ")}); choose a clean product photo`,
    );
  }

  return processed;
}

/**
 * Stores already-processed bytes and returns the public URL for the row.
 *
 * ORDERING: the previous object is deleted only AFTER the new upload succeeds.
 * A crash between the two must leave a stale object — which the storage sweep
 * can find and reclaim — rather than a row pointing at nothing, which nothing
 * can repair.
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
      await upload({
        bucket: "brand-images",
        path,
        data: processed.buffer,
        contentType: processed.contentType,
        upsert: true,
      });
      /*
       * `curated_products` has no `image_storage_path` column, so `image_url`
       * IS the stored reference. Since DEV-1551 it holds the same-origin
       * `/i/curated-products/…` form rather than a public storage URL — the
       * bucket is private, so the old value would be a dead link.
       */
      const url = imagePathToUrl(path);
      if (!url) {
        throw new Error(`Unable to derive an image URL for key: ${path}`);
      }

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
    { readSignals: deps.readSignals },
  );
  return uploadCuratedProductImage({ ...input, processed }, deps);
}
