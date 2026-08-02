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
