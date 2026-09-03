/**
 * Image ranking — shared hero/product image ordering.
 *
 * Extracted from `classify-images.ts` so the same quality sort is available to
 * both the brand hero pipeline (4:3 frame) and the product agent (1:1 frame)
 * without duplicating the crop-damage + portrait-prior logic.
 */

import { cropDamage } from "@/lib/images/crop-damage";
import { isLogoImageTags } from "@/lib/constants/brand-images";
import {
  CROP_DAMAGE_WEIGHT,
  PORTRAIT_QUALITY_PRIOR,
  JUNK_TAGS,
  type ClassifiedImage,
} from "./classify-images";

export type { ClassifiedImage };

/**
 * Superset of ClassifiedImage that may carry a source URL for product-level
 * filtering. The `sourceUrl` maps to `brand_images.source_url` — the page the
 * image was scraped from.
 *
 * `imageUrl` (the image's own url) lives on `ClassifiedImage` itself: both
 * row-backed construction sites fill it, so a pool loaded back out of
 * `brand_images` carries it too.
 */
export type RankableImage = ClassifiedImage & {
  sourceUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Internals moved from classify-images.ts
// ---------------------------------------------------------------------------

/**
 * Damage below this is free, damage at or above it costs the full weight.
 * See the original doc comment in classify-images.ts (now deleted there).
 */
const CROP_DAMAGE_FLOOR = 0.1;
const CROP_DAMAGE_CEILING = 0.5;

/**
 * Shape corrections are quantised to this before subtraction.
 * Prevents float noise from swapping near-tied images across runs.
 */
const SHAPE_CORRECTION_STEPS_PER_POINT = 10;

/** Taller than wide. Square and unknown-dimension images carry no quality prior. */
function isPortrait(image: ClassifiedImage): boolean {
  const { width, height } = image;
  return (
    typeof width === "number" && typeof height === "number" && height > width
  );
}

/**
 * Scaled crop-damage penalty, parameterized by targetRatio so the same logic
 * works for both hero (4:3) and product (1:1) frames.
 */
function cropDamagePenalty(
  image: ClassifiedImage,
  targetRatio: number,
): number {
  const damage = cropDamage({
    width: image.width,
    height: image.height,
    isLogo: image.isLogo ?? isLogoImageTags([image.tag]),
    targetRatio,
  });

  const scaled =
    (damage - CROP_DAMAGE_FLOOR) / (CROP_DAMAGE_CEILING - CROP_DAMAGE_FLOOR);
  return CROP_DAMAGE_WEIGHT * Math.min(Math.max(scaled, 0), 1);
}

/**
 * The single ranking signal: score minus shape correction.
 *
 *   heroQuality = score - cropDamagePenalty(targetRatio) - portraitQualityPrior
 */
function heroQuality(image: ClassifiedImage, targetRatio: number): number {
  const correction =
    cropDamagePenalty(image, targetRatio) +
    (isPortrait(image) ? PORTRAIT_QUALITY_PRIOR : 0);
  const quantised =
    Math.round(correction * SHAPE_CORRECTION_STEPS_PER_POINT) /
    SHAPE_CORRECTION_STEPS_PER_POINT;
  return image.score - quantised;
}

/**
 * Exposed for `planHeroResort` diagnostic data — not part of the ranking API.
 * Prefer `rank()` for ordering.
 */
export { heroQuality as heroQualityForAspect };
export { cropDamagePenalty as cropDamagePenaltyForAspect };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank a pool of classified images by quality for a given frame aspect ratio.
 *
 * Filters out rejected images and junk-tagged images, then sorts descending
 * by `heroQuality`.
 *
 * @param pool     Images to rank — may include rejects; they are filtered out.
 * @param frameAspect  Width / height of the rendering frame (e.g. 4/3 for hero, 1 for square).
 */
export function rank(
  pool: readonly ClassifiedImage[],
  frameAspect: number,
): ClassifiedImage[] {
  return pool
    .filter(
      (image) =>
        image.disposition !== "reject" &&
        !JUNK_TAGS.has(image.tag),
    )
    .toSorted(
      (left, right) =>
        heroQuality(right, frameAspect) - heroQuality(left, frameAspect),
    );
}

/**
 * Pick the best image for a specific product page.
 *
 * Filters `pool` to images whose `sourceUrl` matches `pageUrl`, ranks by
 * `frameAspect` (default 1 — square, the common product-card shape), and
 * returns the top-ranked image or null.
 */
export function rankForProduct(
  pool: readonly RankableImage[],
  pageUrl: string,
  frameAspect: number = 1,
): RankableImage | null {
  const matching = pool.filter(
    (image) => image.sourceUrl != null && image.sourceUrl === pageUrl,
  );
  const ranked = rank(matching, frameAspect);
  return (ranked[0] as RankableImage | undefined) ?? null;
}
