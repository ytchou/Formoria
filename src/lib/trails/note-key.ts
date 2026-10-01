/**
 * The key a trail section's frontmatter `notes` record uses for one pick:
 * `brandSlug/productKey`. Pure and dependency-free so the client trail
 * component, the server loader, the supply report, and the authoring scripts
 * all build and validate it the same way.
 *
 * scripts/checks/trail-frontmatter.mjs cannot import TypeScript and mirrors
 * NOTE_KEY; keep the two in sync.
 */

/** One segment of a note key: a brand slug or a product key. */
export const NOTE_KEY_SEGMENT = /^[a-z0-9-]+$/;

/** A whole note key, `brandSlug/productKey`. */
export const NOTE_KEY = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export function pickNoteKey(brandSlug: string, productKey: string): string {
  return `${brandSlug}/${productKey}`;
}
