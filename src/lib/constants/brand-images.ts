// Per-brand image caps. Shared by owner-facing forms, admin review, and the
// request validation schemas so the number lives in exactly one place.

// Maximum number of active images a brand can show (hero + gallery).
// Image quality is enforced by the acquisition-time gates, not by this count.
export const MAX_BRAND_ACTIVE_IMAGES = 10

// Gallery photos exclude the hero, which always occupies one active slot.
export const MAX_BRAND_GALLERY_PHOTOS = MAX_BRAND_ACTIVE_IMAGES - 1

// Highest `sort_order` this cap will assign to a newly placed active image.
// NOTE: there is no matching database CHECK constraint — legacy rows written
// before the cap existed reach sort_order 13.
export const MAX_BRAND_ACTIVE_SORT_ORDER = MAX_BRAND_ACTIVE_IMAGES - 1

// How many images one admin review save may SUBMIT — deliberately wider than
// MAX_BRAND_ACTIVE_IMAGES, and not a second display cap.
//
// Brands enriched before the cap existed still carry more active rows than it
// allows (14 at the widest, as of 2026-08). The review form submits every
// active image, and `saveAdminBrandReview` rejects the whole payload when any
// active image is missing from it — so validating the payload against the
// display cap does not trim those galleries, it blocks the brand from being
// edited at all. That was the silent-save-failure bug on /admin/brands.
//
// Retire this once no brand exceeds MAX_BRAND_ACTIVE_IMAGES:
//   select brand_id, count(*) from brand_images where status = 'active'
//     group by brand_id having count(*) > 10;
export const MAX_BRAND_IMAGE_SELECTION = 24

// Parking slot for staged draft rows that have not been placed in the gallery
// yet. Invariant: this MUST sort above every active row the table can hold, so
// a parked draft can never collide with a real gallery position.
//
// Derived from MAX_BRAND_IMAGE_SELECTION rather than MAX_BRAND_ACTIVE_IMAGES:
// the display cap is 10, but legacy brands hold active rows up to sort_order
// 13, so parking at the display cap lands *inside* the occupied range for
// exactly the brands most likely to be re-edited.
export const DRAFT_PARK_SORT_ORDER = MAX_BRAND_IMAGE_SELECTION

// Aspect ratio of the box brand images render into — the `aspect-[4/3]` card
// and detail frames, which use `object-cover` and therefore crop anything that
// is not already this shape. Kept here so ranking scores the crop an image will
// really receive against the same number the layout enforces; if the frames ever
// change ratio, this constant must move with them or ranking silently optimises
// for a box that no longer exists.
export const HERO_TARGET_RATIO = 4 / 3

// The classification tag that switches an image from cover-cropping to
// `object-contain`. A logo's surrounding whitespace is part of the mark, so
// cropping it is a defect rather than a framing choice.
export const BRAND_IMAGE_LOGO_TAG = 'logo'

/**
 * The single definition of "this image is a logo".
 *
 * It lives in this leaf module, NOT next to the tag vocabulary in
 * `enrich-phases/classify-images.ts`, because that module pulls in the OpenAI
 * client, the vision loader, `sharp` (via `image-download`) and the Supabase
 * service client. Every render site that needs this predicate is a client
 * component, so importing from there would drag server-only dependencies into
 * the browser bundle. This file has no imports at all and `classify-images.ts`
 * already reads `HERO_TARGET_RATIO` from it, so the dependency runs the safe
 * way round. `classify-images.ts` imports the predicate from here too — there
 * is exactly one definition.
 *
 * Note the semantics: MEMBERSHIP in the tag list, not "the first classification
 * tag". Ranking used to ask `tag === 'logo'` while every renderer asked
 * `tags.includes('logo')`, so a row tagged `['product', 'logo']` was charged up
 * to CROP_DAMAGE_WEIGHT points for a crop it would never receive — it renders
 * `object-contain`. No writer emits multi-tag rows today, but `tags` is a bare
 * `text[]` with no constraint, so nothing prevents one.
 */
export function isLogoImageTags(tags: readonly string[] | null | undefined): boolean {
  return tags?.includes(BRAND_IMAGE_LOGO_TAG) ?? false
}

