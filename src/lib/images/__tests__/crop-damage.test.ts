import { describe, expect, it } from 'vitest'

import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'

import { cropDamage } from '../crop-damage'

/** Aspect ratios used by the sweeping property tests. */
const ASPECT_RATIOS = [0.3, 0.5, 0.75, 0.9, 1, 4 / 3, 1.5, 16 / 9, 2.4, 3.0]

describe('cropDamage', () => {
  it('scores an exact 4/3 source as undamaged', () => {
    expect(cropDamage({ width: 1200, height: 900 })).toBe(0)
  })

  it('scores a square at 4/3 as losing a quarter of its area', () => {
    // visible = 1 / (4/3) = 0.75, so areaLoss = 0.25.
    expect(cropDamage({ width: 1000, height: 1000 })).toBeCloseTo(0.25, 10)
  })

  it('scores a 3/4 portrait at 4/3 as losing more than half again', () => {
    // visible = 0.75 / (4/3) = 0.5625, so areaLoss = 0.4375.
    expect(cropDamage({ width: 900, height: 1200 })).toBeCloseTo(0.4375, 10)
  })

  it('scores a landscape source symmetrically with its portrait mirror', () => {
    // The crop only ever cuts one axis, so 4/3-ness is symmetric: a source that
    // is k times too wide loses the same area as one k times too tall.
    expect(cropDamage({ width: 1200, height: 675 })).toBeCloseTo(
      cropDamage({ width: 675 * (HERO_TARGET_RATIO * HERO_TARGET_RATIO), height: 1200 }),
      10,
    )
  })

  describe('logos', () => {
    it('never charges a logo, however extreme its shape', () => {
      // Logos render `object-contain` and are letterboxed, not cropped. This
      // strip would otherwise score near the maximum, so a missing carve-out
      // cannot hide here.
      expect(cropDamage({ width: 4000, height: 200, isLogo: true })).toBe(0)
      expect(cropDamage({ width: 200, height: 4000, isLogo: true })).toBe(0)
    })

    it('charges the same shape once it is not flagged as a logo', () => {
      expect(cropDamage({ width: 4000, height: 200 })).toBeGreaterThan(0.8)
    })
  })

  describe('missing or invalid dimensions', () => {
    const cases: Array<{
      label: string
      width: number | null | undefined
      height: number | null | undefined
    }> = [
      { label: 'both null', width: null, height: null },
      { label: 'null width', width: null, height: 900 },
      { label: 'null height', width: 1200, height: null },
      { label: 'undefined', width: undefined, height: undefined },
      { label: 'zero width', width: 0, height: 900 },
      { label: 'zero height', width: 1200, height: 0 },
      { label: 'negative width', width: -1200, height: 900 },
      { label: 'negative height', width: 1200, height: -900 },
    ]

    it.each(cases)('leaves $label unpenalised', ({ width, height }) => {
      expect(cropDamage({ width, height })).toBe(0)
    })
  })

  describe('properties over a swept grid', () => {
    it('stays within [0, 1]', () => {
      for (const ratio of ASPECT_RATIOS) {
        const damage = cropDamage({ width: 1000 * ratio, height: 1000 })
        expect(damage).toBeGreaterThanOrEqual(0)
        expect(damage).toBeLessThanOrEqual(1)
        expect(Number.isFinite(damage)).toBe(true)
      }
    })

    it('grows monotonically as a source moves away from the target ratio', () => {
      const tallToWide = [0.3, 0.5, 0.75, 1, HERO_TARGET_RATIO]
      const damages = tallToWide.map((ratio) => cropDamage({ width: 1000 * ratio, height: 1000 }))

      damages.reduce((previous, current) => {
        expect(current).toBeLessThan(previous)
        return current
      })
    })
  })

  describe('targetRatio', () => {
    it('defaults to the hero box', () => {
      expect(cropDamage({ width: 1000, height: 1000 })).toBe(
        cropDamage({ width: 1000, height: 1000, targetRatio: HERO_TARGET_RATIO }),
      )
    })

    it('scores a square as undamaged in a square box', () => {
      expect(cropDamage({ width: 1000, height: 1000, targetRatio: 1 })).toBe(0)
    })
  })
})
