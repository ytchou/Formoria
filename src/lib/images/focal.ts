/**
 * Focal-point rendering helper.
 *
 * The measurement side lives in `@/lib/services/image-download`
 * (`computeFocalPoint`); this is the render side, kept pure and free of `sharp`
 * so client components can import it.
 */

/** The subset of image metadata this helper needs — anything focal-bearing fits. */
type FocalBearing = {
  focalX: number | null
  focalY: number | null
}

/**
 * `object-position` for an image that renders with `object-cover`, or
 * `undefined` when we have no measurement.
 *
 * `undefined` is deliberate: omitting the property leaves the CSS default of
 * `50% 50%`, which is exactly what every image does today, so an unmeasured
 * image is unchanged rather than mis-framed.
 *
 * Percentages need no extra math despite the box and the image having different
 * aspect ratios. Under `object-cover`, `object-position: p%` aligns the
 * image's p% point with the box's p% point — that is already focal-point
 * semantics, and it holds at 4/3, 1/1 and 16/9 simultaneously.
 */
export function objectPositionStyle(
  meta?: FocalBearing | null,
): { objectPosition: string } | undefined {
  const x = meta?.focalX
  const y = meta?.focalY
  // Explicit null/undefined checks, never a falsy test: 0 is a legitimate
  // focal coordinate (subject flush against the left or top edge) and a truthy
  // guard would silently discard exactly the images that need this most.
  if (x === null || x === undefined || y === null || y === undefined) return undefined

  return { objectPosition: `${x * 100}% ${y * 100}%` }
}

/** Anything carrying the two decisions this helper makes: fill mode, and where to anchor it. */
type BrandImageFraming = FocalBearing & { isLogo?: boolean | null }

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
   * pass it here, and still pass v1's `bg-muted`.
   */
  logoPlate?: string
  /**
   * How a NON-logo image fills its box. Defaults to `cover`.
   *
   * This is a per-surface decision, not a global one, and the two answers come
   * from what the surface is for:
   *
   * - `cover` where brands are compared side by side (directory grid, cards,
   *   favorites, microsite hero). Mismatched aspect ratios letterbox to
   *   different widths, and a row of unequal grey strips is what made the grid
   *   read as ragged — the defect DEV-1406 set out to fix.
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
 * Two coupled decisions that were previously hand-copied into seven render
 * sites: a logo is CONTAINED (its surrounding whitespace is part of the mark,
 * so cropping it is a defect), everything else COVERS and is anchored on its
 * measured focal point. Copies drift, and they had: the two admin review
 * previews omitted `objectPositionStyle` entirely, so a moderator judging a
 * submission saw a centre-cropped frame while the same image shipped
 * focal-cropped — the preview stopped showing what would actually render.
 *
 * Returns a `{ className, style }` pair rather than a wrapper component
 * deliberately: `next/image` `fill` usage varies too much across these seven
 * sites (sizes, preload, error handling, and one raw `<img>`) for a component
 * not to need an escape hatch per site.
 *
 * `style` is `undefined`, never `{}`, when there is nothing to position — see
 * `objectPositionStyle`, whose contract that is. SPREAD IT AND YOU BREAK THAT:
 * `style={{ ...fill.style }}` converts the meaningful `undefined` into an empty
 * object. Assign it directly (`style={fill.style}`); only merge when you have
 * other real properties to add.
 */
export function brandImageFill(
  meta: BrandImageFraming | null | undefined,
  options: BrandImageFillOptions = {},
): { className: string; style: { objectPosition: string } | undefined } {
  const isLogo = Boolean(meta?.isLogo)

  if (isLogo || options.fit === 'contain') {
    return {
      // `logoPlate` and `inset` are logo-only. A contained PHOTO wants neither:
      // the plate is there to make a floating mark look deliberate, and the
      // inset would shrink a product shot away from the frame it is meant to
      // fill as fully as its aspect ratio allows.
      className: [
        isLogo ? options.logoPlate : undefined,
        'object-contain',
        isLogo ? options.inset : undefined,
      ]
        .filter(Boolean)
        .join(' '),
      // A contained image is never cropped, so there is no window to anchor and
      // `object-position` would only shift it inside its own letterbox.
      style: undefined,
    }
  }

  return { className: 'object-cover', style: objectPositionStyle(meta) }
}
