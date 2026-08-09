import { describe, expect, it } from 'vitest'

import { brandImageFill, objectPositionStyle } from '../focal'

describe('objectPositionStyle', () => {
  it('converts a measured point to object-position percentages', () => {
    expect(objectPositionStyle({ focalX: 0.25, focalY: 0.75 })).toEqual({
      objectPosition: '25% 75%',
    })
  })

  it('preserves zero focal coordinates', () => {
    expect(objectPositionStyle({ focalX: 0, focalY: 0 })).toEqual({
      objectPosition: '0% 0%',
    })
  })

  it('leaves an unmeasured image at the CSS centre default', () => {
    expect(objectPositionStyle({ focalX: null, focalY: null })).toBeUndefined()
  })
})

describe('brandImageFill', () => {
  /*
   * One helper, seven render sites. Before it, the carve-out was hand-copied
   * and the two admin previews had drifted: they added `bg-muted` and OMITTED
   * `object-position`, so a moderator judged a centre-cropped frame of an image
   * that ships focal-cropped. These pin the contract that made that possible.
   */
  it('covers and anchors a normal image on its focal point', () => {
    expect(
      brandImageFill({ isLogo: false, focalX: 0.25, focalY: 0.75 }, { inset: 'p-6' }),
    ).toEqual({ className: 'object-cover', style: { objectPosition: '25% 75%' } })
  })

  it('contains a logo with its per-surface inset and never positions it', () => {
    // A contained image is not cropped, so there is no window to anchor —
    // `object-position` would only shift it inside its own letterbox.
    expect(
      brandImageFill({ isLogo: true, focalX: 0.1, focalY: 0.2 }, { inset: 'p-1.5' }),
    ).toEqual({ className: 'object-contain p-1.5', style: undefined })
  })

  it('preserves the meaningful undefined for an unmeasured image', () => {
    // `objectPositionStyle`'s contract: omitting the property leaves the CSS
    // default of 50% 50%, which is exactly what an unmeasured image did before
    // focal points existed. An empty object here would be a silent regression
    // for any caller that spreads the result.
    const fill = brandImageFill({ isLogo: false, focalX: null, focalY: null })
    expect(fill.style).toBeUndefined()
    expect(fill.className).toBe('object-cover')
  })

  it('treats missing metadata as a normal, unmeasured image', () => {
    expect(brandImageFill(null)).toEqual({ className: 'object-cover', style: undefined })
    expect(brandImageFill(undefined)).toEqual({ className: 'object-cover', style: undefined })
  })

  it('paints the logo plate only when a surface asks for one', () => {
    // The admin previews have no container behind the image, so the plate is a
    // deliberate parameter rather than the accident it looked like when the
    // carve-out was copy-pasted.
    expect(
      brandImageFill({ isLogo: true, focalX: null, focalY: null }, {
        inset: 'p-6',
        logoPlate: 'bg-muted',
      }).className,
    ).toBe('bg-muted object-contain p-6')
    expect(
      brandImageFill({ isLogo: true, focalX: null, focalY: null }, { inset: 'p-6' }).className,
    ).toBe('object-contain p-6')
  })

  describe('fit', () => {
    it('covers by default, because most surfaces compare brands side by side', () => {
      expect(brandImageFill({ isLogo: false, focalX: 0.25, focalY: 0.75 }).className).toBe(
        'object-cover',
      )
    })

    it('contains a photo when the surface asks, and drops the anchor with it', () => {
      // The detail hero shows one product with nothing beside it (DEV-1407).
      // A contained image is never cropped, so there is no window to anchor —
      // returning a focal point here would move the image inside its own
      // letterbox for no reason.
      const fill = brandImageFill({ isLogo: false, focalX: 0.25, focalY: 0.75 }, {
        fit: 'contain',
      })
      expect(fill.className).toBe('object-contain')
      expect(fill.style).toBeUndefined()
    })

    it('does not give a contained PHOTO the logo plate or inset', () => {
      // Both are logo affordances: the plate makes a floating mark look
      // deliberate, and the inset keeps it off the frame edge. A product shot
      // wants neither — it should fill as much of the box as its aspect ratio
      // allows. The carousel passes `inset` for the logo case in the same call,
      // so this asymmetry is load-bearing rather than theoretical.
      expect(
        brandImageFill({ isLogo: false, focalX: null, focalY: null }, {
          fit: 'contain',
          inset: 'p-6',
          logoPlate: 'bg-muted',
        }).className,
      ).toBe('object-contain')
    })

    it('still contains a logo when the surface asks for cover', () => {
      expect(
        brandImageFill({ isLogo: true, focalX: null, focalY: null }, {
          fit: 'cover',
          inset: 'p-6',
        }).className,
      ).toBe('object-contain p-6')
    })
  })
})
