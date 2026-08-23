import { describe, expect, it } from 'vitest'

import { brandImageFill } from '../fill'

describe('brandImageFill', () => {
  /*
   * One helper, seven render sites. Before it, the carve-out was hand-copied
   * and the two admin previews had drifted from the public surfaces, so a
   * moderator judged a frame that was not the one that shipped. These pin the
   * contract that made that possible.
   */
  it('returns object-cover for a non-logo', () => {
    expect(brandImageFill({ isLogo: false })).toBe('object-cover')
  })

  it('returns object-contain plus plate and inset for a logo', () => {
    // The admin previews have no container behind the image, so the plate is a
    // deliberate parameter rather than the accident it looked like when the
    // carve-out was copy-pasted.
    expect(brandImageFill({ isLogo: true }, { inset: 'p-6', logoPlate: 'bg-surface' })).toBe(
      'bg-surface object-contain p-6',
    )
    expect(brandImageFill({ isLogo: true }, { inset: 'p-6' })).toBe('object-contain p-6')
  })

  it('returns object-contain without plate or inset for a contained photo', () => {
    // Both are logo affordances: the plate makes a floating mark look
    // deliberate, and the inset keeps it off the frame edge. A product shot
    // wants neither — it should fill as much of the box as its aspect ratio
    // allows. The carousel passes `inset` for the logo case in the same call,
    // so this asymmetry is load-bearing rather than theoretical (DEV-1407).
    expect(
      brandImageFill({ isLogo: false }, { fit: 'contain', inset: 'p-6', logoPlate: 'bg-surface' }),
    ).toBe('object-contain')
  })

  it('handles null and undefined meta', () => {
    expect(brandImageFill(null)).toBe('object-cover')
    expect(brandImageFill(undefined)).toBe('object-cover')
  })

  it('ignores inset and logoPlate for a covering image', () => {
    expect(
      brandImageFill({ isLogo: false }, { inset: 'p-6', logoPlate: 'bg-surface' }),
    ).toBe('object-cover')
  })

  it('still contains a logo when the surface asks for cover', () => {
    // A logo's surrounding whitespace is part of the mark, so `fit` never wins
    // over it.
    expect(brandImageFill({ isLogo: true }, { fit: 'cover', inset: 'p-6' })).toBe(
      'object-contain p-6',
    )
  })

  it('covers a non-logo that asks for cover', () => {
    // Cover is the default because most surfaces compare brands side by side;
    // this is the case where an explicit `fit` agrees with that default. Until
    // now `fit: 'cover'` was only ever exercised against a logo, where it loses
    // to `object-contain`.
    expect(brandImageFill({ isLogo: false }, { fit: 'cover' })).toBe(
      'object-cover',
    )
  })
})
