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
