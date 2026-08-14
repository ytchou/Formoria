import crypto from "node:crypto";

import { auditedCall } from "@/lib/audit";
import { processImage } from "@/lib/security/image-processor";
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

export type CuratedProductImageInput = {
  brandId: string;
  productId: string;
  /** The page-published image URL an editor confirmed. */
  imageSourceUrl: string;
  /** The public URL currently stored on the row, if any. */
  previousImageUrl?: string | null;
};

export function curatedProductImageKey(input: {
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
 * Downloads, normalizes, and stores one curated-product image, returning the
 * public URL to write onto the row.
 *
 * `processImage` THROWS on GIF and SVG (its format allowlist is jpeg/png/webp),
 * on anything over 5 MB, and on undecodable bytes. That throw is propagated
 * deliberately: the caller surfaces it as a FIELD error on the image URL, since
 * "this image cannot be used" is a fact about the value the editor typed, not
 * an internal failure to swallow.
 *
 * ORDERING: the previous object is deleted only AFTER the new upload succeeds.
 * A crash between the two must leave a stale object — which the storage sweep
 * can find and reclaim — rather than a row pointing at nothing, which nothing
 * can repair.
 *
 * `image_usage` is NOT touched here. A successful download is not consent; only
 * a human may assert usage rights.
 */
export async function storeCuratedProductImage(
  input: CuratedProductImageInput,
): Promise<{ url: string }> {
  return auditedCall(
    {
      provider: "images",
      operation: "storeCuratedProductImage",
      kind: "service",
    },
    async () => {
      // The fetch is audited on its own span (`http.fetch_curated_image`) so
      // the bytes stored against a product trace back to the exact request.
      const buffer = await auditedCall(
        {
          provider: "http",
          operation: "fetch_curated_image",
          kind: "external",
        },
        async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            IMAGE_FETCH_TIMEOUT_MS,
          );
          try {
            const response = await fetch(input.imageSourceUrl, {
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(
                `Could not download the image (HTTP ${response.status})`,
              );
            }
            return Buffer.from(await response.arrayBuffer());
          } finally {
            clearTimeout(timeoutId);
          }
        },
        { subjectId: input.productId },
      );

      const processed = await processImage(buffer);
      const path = curatedProductImageKey(input);
      // `upsert: true` is safe here and only here: the path is DERIVED from the
      // source URL, so re-saving the same source overwrites in place instead of
      // orphaning an object on every apply.
      const { url } = await uploadPublicImage({
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
          await deleteStoredImagePaths([previousKey]);
        } catch (error) {
          console.error(
            "[curatedProducts] stale image cleanup failed",
            previousKey,
            error,
          );
        }
      }

      return { url };
    },
    { subjectId: input.productId },
  );
}
