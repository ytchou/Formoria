import { describe, expect, it } from 'vitest'

import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'

import { cropDamage } from '../crop-damage'

/** Aspect ratios and focal values used by the sweeping property tests. */
const ASPECT_RATIOS = [0.3, 0.5, 0.75, 0.9, 1, 4 / 3, 1.5, 16 / 9, 2.4, 3.0]
const FOCALS = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]

describe('cropDamage', () => {
  it('scores an exact 4/3 source as undamaged', () => {
    expect(cropDamage({ width: 1200, height: 900 })).toBe(0)
  })

  it('scores a square at 4/3 as losing a quarter of its area', () => {
    // visible = 1 / (4/3) = 0.75, so areaLoss = 0.25 and a centred subject adds
    // nothing on top.
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

    it('ignores the focal point entirely for logos', () => {
      expect(cropDamage({ width: 4000, height: 200, isLogo: true, focalX: 0 })).toBe(0)
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

  describe('focal point', () => {
    it('treats a null focal point as centred', () => {
      const measured = cropDamage({ width: 1000, height: 1000, focalX: 0.5, focalY: 0.5 })
      const unmeasured = cropDamage({ width: 1000, height: 1000, focalX: null, focalY: null })
      const absent = cropDamage({ width: 1000, height: 1000 })

      expect(unmeasured).toBe(measured)
      expect(absent).toBe(measured)
    })

    it('adds nothing when the subject sits at the centre', () => {
      expect(cropDamage({ width: 1000, height: 1000, focalY: 0.5 })).toBeCloseTo(0.25, 10)
    })

    it('doubles the damage when the subject sits on the cropped edge', () => {
      // A square at 4/3 is cut top and bottom, so focalY is the axis that
      // matters: at 0 the subject is fully outside the centred window, giving
      // focalMiss = 1 and damage = areaLoss * 2.
      expect(cropDamage({ width: 1000, height: 1000, focalY: 0 })).toBeCloseTo(0.5, 10)
      expect(cropDamage({ width: 1000, height: 1000, focalY: 1 })).toBeCloseTo(0.5, 10)
    })

    it('reads focalX on a source that is cut horizontally', () => {
      // Wider than 4/3 → the sides are cut, so focalY must not move the score
      // and focalX must.
      const wide = { width: 2000, height: 1000 }
      expect(cropDamage({ ...wide, focalY: 0 })).toBe(cropDamage(wide))
      expect(cropDamage({ ...wide, focalX: 0 })).toBeGreaterThan(cropDamage(wide))
    })

    it('reads focalY on a source that is cut vertically', () => {
      const tall = { width: 900, height: 1200 }
      expect(cropDamage({ ...tall, focalX: 0 })).toBe(cropDamage(tall))
      expect(cropDamage({ ...tall, focalY: 0 })).toBeGreaterThan(cropDamage(tall))
    })

    /*
     * Regression guard for the CSS model itself.
     *
     * `object-position: p%` aligns the image's p% point with the box's p%
     * point, so the surviving window is `[f * (1 - visible), ... + visible]` —
     * it is NOT centred on the focal point. A centred model agrees with CSS
     * only at f ∈ {0, 0.5, 1}, which is exactly the set every other case in
     * this file used, so it shipped undetected and reported ZERO focal damage
     * for images the page really does crop off-subject.
     *
     * 800x1200 is chosen so `visible` is exactly 0.5 at the 4/3 hero box
     * (a = 2/3, visible = (2/3) / (4/3)), which makes the arithmetic below
     * checkable by hand: areaLoss = 0.5 and the cut axis is y.
     */
    describe('intermediate focal values (the centred-window model got these wrong)', () => {
      const halfVisible = { width: 800, height: 1200 }

      it.each([
        // focalY, focalMiss = 2 * |f - 0.5|, damage = 0.5 * (1 + focalMiss)
        [0.25, 0.75],
        [0.75, 0.75],
        [0.4, 0.6],
        [0.6, 0.6],
        [0.1, 0.9],
      ])('charges focalY %s a damage of %s', (focalY, expected) => {
        expect(cropDamage({ ...halfVisible, focalY, focalAware: true })).toBeCloseTo(expected, 10)
      })

      it('reports non-zero focal damage where the centred model reported none', () => {
        // The specific number the bug produced: the old code clamped the window
        // to [0, 0.5], put its centre at 0.25, and scored focalMiss = 0 — i.e.
        // bare areaLoss, as if the subject were dead centre.
        const damage = cropDamage({ ...halfVisible, focalY: 0.25, focalAware: true })
        expect(damage).toBeGreaterThan(0.5)
        expect(damage).toBeCloseTo(0.75, 10)
      })

      it('depends only on the focal point, not on how much is cropped', () => {
        // The algebraic consequence of proportional alignment: `visible`
        // cancels out of focalMiss, so the focal term is the same at any crop
        // severity and only the multiplicative areaLoss differs.
        const mild = cropDamage({ width: 1000, height: 1000, focalY: 0.25, focalAware: true })
        const severe = cropDamage({ width: 900, height: 1200, focalY: 0.25, focalAware: true })

        // areaLoss 0.25 and 0.4375 respectively, both multiplied by the same
        // (1 + focalMiss) = 1.5.
        expect(mild).toBeCloseTo(0.25 * 1.5, 10)
        expect(severe).toBeCloseTo(0.4375 * 1.5, 10)
      })
    })

    it('is irrelevant when nothing is cropped', () => {
      // The multiplicative property: with areaLoss at 0 there is no crop to sit
      // outside of, so an off-centre subject must cost exactly nothing.
      for (const focal of FOCALS) {
        expect(cropDamage({ width: 1200, height: 900, focalX: focal, focalY: focal })).toBe(0)
        expect(
          cropDamage({ width: 1200, height: 900, focalX: focal, focalY: focal, focalAware: true }),
        ).toBe(0)
      }
    })
  })

  describe('properties over a swept grid', () => {
    it('never scores a focal-aware renderer worse than a centred one', () => {
      // Still holds under the corrected (proportional-alignment) window, and
      // is what made flipping the `focalAware` default safe. Algebraically:
      // focal-aware focalMiss is 2|f - 0.5|, centred is 2|f - 0.5| / visible,
      // and `visible` is in (0, 1] — so the aware branch is never larger.
      for (const ratio of ASPECT_RATIOS) {
        for (const focal of FOCALS) {
          const base = { width: 1000 * ratio, height: 1000, focalX: focal, focalY: focal }
          expect(cropDamage({ ...base, focalAware: true })).toBeLessThanOrEqual(
            cropDamage({ ...base, focalAware: false }) + 1e-12,
          )
        }
      }
    })

    it('defaults to the focal-aware model that actually ships', () => {
      // Every brand image surface emits `object-position` now, so the default
      // must model that renderer. Guards against the default silently
      // reverting to the centred model, which would mis-score exactly the
      // images the page frames well.
      for (const ratio of ASPECT_RATIOS) {
        for (const focal of FOCALS) {
          const base = { width: 1000 * ratio, height: 1000, focalX: focal, focalY: focal }
          expect(cropDamage(base)).toBe(cropDamage({ ...base, focalAware: true }))
        }
      }
    })

    it('stays within [0, 1]', () => {
      for (const ratio of ASPECT_RATIOS) {
        for (const focal of FOCALS) {
          for (const focalAware of [false, true]) {
            const damage = cropDamage({
              width: 1000 * ratio,
              height: 1000,
              focalX: focal,
              focalY: focal,
              focalAware,
            })
            expect(damage).toBeGreaterThanOrEqual(0)
            expect(damage).toBeLessThanOrEqual(1)
            expect(Number.isFinite(damage)).toBe(true)
          }
        }
      }
    })

    it('grows monotonically as a source moves away from the target ratio', () => {
      // Centred subjects only, so the comparison isolates area loss.
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
