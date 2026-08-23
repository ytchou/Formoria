/**
 * Brand image fill helper.
 *
 * The one definition of how a brand image fills its fixed-ratio box, kept pure
 * and free of `sharp` so client components can import it.
 */

/** Anything carrying the one decision this helper makes: how the image fills its box. */
type BrandImageFraming = { isLogo?: boolean | null }

export type BrandImageFillOptions = {
  /**
   * Inset applied to a CONTAINED logo only. Per-surface because it is absolute
   * rather than proportional: the card's `p-6` on a 64px thumbnail would leave
   * a 16px mark.
   */
  inset?: string
  /**
   * Background plate painted behind a contained logo. The public surfaces get
   * this from their own container's `bg-surface-deep` (DESIGN.md §2's image
   * placeholder step); the admin review previews have no such container and
   * pass it here, and pass `bg-surface`.
   */
  logoPlate?: string
  /**
   * How a NON-logo image fills its box. Defaults to `cover`.
   *
   * This is a per-surface decision, not a global one, and the two answers come
   * from what the surface is for:
   *
   * - `cover` where brands are compared side by side (directory grid, cards,
   *   favorites). Mismatched aspect ratios letterbox to different widths,
   *   and a row of unequal grey strips is what made the grid read as ragged —
   *   the defect DEV-1406 set out to fix.
   * - `contain` where a single product is shown large (detail carousel hero,
   *   dashboard hero card). Nothing neighbours it, so there is no raggedness to
   *   fix, and cropping only removes product. 54.7% of active product photos
   *   are exactly square and lose a quarter of their height to a 4/3 cover
   *   crop — DEV-1407.
   *
   * A logo ignores this and is always contained.
   */
  fit?: 'cover' | 'contain'
}

/**
 * The one definition of how a brand image fills its fixed-ratio box.
 *
 * The decision that was previously hand-copied into seven render sites: a logo
 * is CONTAINED (its surrounding whitespace is part of the mark, so cropping it
 * is a defect), everything else COVERS unless its surface asks otherwise.
 * Copies drift, and they had: the two admin review previews had their own
 * carve-out, so a moderator judging a submission saw a frame the public
 * surfaces would never render — the preview stopped showing what would
 * actually ship.
 *
 * Returns a class string rather than a wrapper component deliberately:
 * `next/image` `fill` usage varies too much across these seven sites (sizes,
 * preload, error handling, and one raw `<img>`) for a component not to need an
 * escape hatch per site.
 */
export function brandImageFill(
  meta: BrandImageFraming | null | undefined,
  options: BrandImageFillOptions = {},
): string {
  const isLogo = Boolean(meta?.isLogo)

  if (isLogo || options.fit === 'contain') {
    // `logoPlate` and `inset` are logo-only. A contained PHOTO wants neither:
    // the plate is there to make a floating mark look deliberate, and the
    // inset would shrink a product shot away from the frame it is meant to
    // fill as fully as its aspect ratio allows.
    return [
      isLogo ? options.logoPlate : undefined,
      'object-contain',
      isLogo ? options.inset : undefined,
    ]
      .filter(Boolean)
      .join(' ')
  }

  return 'object-cover'
}
