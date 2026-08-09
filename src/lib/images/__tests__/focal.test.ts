import { describe, expect, it } from 'vitest'

import { objectPositionStyle } from '../focal'

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
