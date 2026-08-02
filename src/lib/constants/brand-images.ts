// Per-brand image caps. Shared by owner-facing forms, admin review, and the
// request validation schemas so the number lives in exactly one place.

// Maximum number of active images a brand can show (hero + gallery).
// Image quality is enforced by the acquisition-time gates, not by this count.
export const MAX_BRAND_ACTIVE_IMAGES = 10

// Gallery photos exclude the hero, which always occupies one active slot.
export const MAX_BRAND_GALLERY_PHOTOS = MAX_BRAND_ACTIVE_IMAGES - 1

// Highest valid `sort_order` for an active image; the database enforces
// `sort_order between 0 and MAX_BRAND_ACTIVE_SORT_ORDER`.
export const MAX_BRAND_ACTIVE_SORT_ORDER = MAX_BRAND_ACTIVE_IMAGES - 1

// Parking slot for staged draft rows that have not been placed in the gallery
// yet. Invariant: this MUST stay outside the valid active range
// (0..MAX_BRAND_ACTIVE_SORT_ORDER) so a parked draft can never collide with a
// real image's position. Derived from the cap so raising the cap moves it too.
export const DRAFT_PARK_SORT_ORDER = MAX_BRAND_ACTIVE_IMAGES
