/**
 * Leaf module: whether a curated product has a photo (DEV-1962, BD-07).
 *
 * A Formoria curated selection is an editorial commitment, and a tile that falls back to a
 * letter placeholder undermines it. The selected-product tile renders
 * `safeImageSrc(product.imageUrl)` and falls back when that is null, so
 * "renderable" is defined by the same function here — one definition shared by
 * the publish gate in the service layer and every public read's filter.
 */
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";

/** True when the selected-product tile would render this URL as a photo. */
export function hasRenderableCuratedImage(
  imageUrl: string | null | undefined,
): boolean {
  return safeImageSrc(imageUrl) !== null;
}

/**
 * The publish precondition: a renderable stored image, OR a source image still
 * waiting to be mirrored. The second arm exists because the generated pipeline
 * publishes before `refresh.ts` / `mirror-images.ts` mirror the image; the
 * public reads keep such a row hidden until `image_url` lands.
 */
export function canPublishCuratedProduct(fields: {
  imageUrl: string | null | undefined;
  imageSourceUrl: string | null | undefined;
}): boolean {
  return (
    hasRenderableCuratedImage(fields.imageUrl) ||
    Boolean(fields.imageSourceUrl?.trim())
  );
}
