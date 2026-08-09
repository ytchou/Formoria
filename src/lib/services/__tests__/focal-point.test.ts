import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { processImage } from '@/lib/security/image-processor'

import { computeFocalPoint } from '../image-download'

async function makeImage(input: {
  width: number
  height: number
  left: number
  top: number
  size: number
}): Promise<Buffer> {
  return sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: { r: 24, g: 24, b: 24 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: input.size,
            height: input.size,
            channels: 3,
            background: { r: 255, g: 40, b: 40 },
          },
        },
        left: input.left,
        top: input.top,
      },
    ])
    .png()
    .toBuffer()
}

describe('computeFocalPoint', () => {
  it('finds an off-centre subject in both axes within a useful tolerance band', async () => {
    const image = await makeImage({
      width: 1_000,
      height: 600,
      left: 820,
      top: 400,
      size: 120,
    })

    const focalPoint = await computeFocalPoint(image)

    expect(focalPoint).not.toBeNull()
    // Upper bound is inclusive of 1, deliberately: `resolveAxis` rescales the
    // probe's structurally reachable band [0.125, 0.875] onto [0, 1], so a
    // near-edge subject like this one (x centre 0.88, y centre 0.77) maps the
    // probe ceiling to exactly 1. A stricter `< 0.98` was calibrated against
    // the pre-rescale band and is now unreachable — do not tighten it back.
    expect(focalPoint?.x).toBeGreaterThan(0.7)
    expect(focalPoint?.x).toBeLessThanOrEqual(1)
    expect(focalPoint?.y).toBeGreaterThan(0.65)
    expect(focalPoint?.y).toBeLessThanOrEqual(1)
  })

  /*
   * The mirror of the case above, and not redundant with it: an implementation
   * that dropped the flip-check de-biasing, or that mixed up the probe axis
   * sign, still lands a right-of-centre subject in the right half by accident.
   * Only a left-side subject separates "reads the image" from "drifts high".
   */
  it('finds a left-of-centre subject rather than mirroring the right-side case', async () => {
    const image = await makeImage({
      width: 1_000,
      height: 600,
      left: 60,
      top: 60,
      size: 120,
    })

    const focalPoint = await computeFocalPoint(image)

    expect(focalPoint).not.toBeNull()
    expect(focalPoint?.x).toBeLessThan(0.3)
    expect(focalPoint?.y).toBeLessThan(0.35)
  })

  it('centres a centred subject', async () => {
    const image = await makeImage({
      width: 1_000,
      height: 600,
      left: 440,
      top: 240,
      size: 120,
    })

    const focalPoint = await computeFocalPoint(image)

    expect(focalPoint?.x).toBeGreaterThan(0.4)
    expect(focalPoint?.x).toBeLessThan(0.6)
    expect(focalPoint?.y).toBeGreaterThan(0.4)
    expect(focalPoint?.y).toBeLessThan(0.6)
  })

  /*
   * Extreme source shapes are exactly the population this feature exists for —
   * the download gate admits anything from 0.33 to 3.0 — so both ends must at
   * minimum stay in range rather than throwing or escaping [0,1].
   */
  it.each([
    ['portrait', 800, 1_200],
    ['wide banner', 1_500, 500],
  ])('keeps %s sources inside the unit square', async (_label, width, height) => {
    const image = await makeImage({
      width,
      height,
      left: Math.round(width * 0.7),
      top: Math.round(height * 0.2),
      size: Math.round(Math.min(width, height) / 10),
    })

    const focalPoint = await computeFocalPoint(image)

    expect(focalPoint).not.toBeNull()
    expect(focalPoint?.x).toBeGreaterThanOrEqual(0)
    expect(focalPoint?.x).toBeLessThanOrEqual(1)
    expect(focalPoint?.y).toBeGreaterThanOrEqual(0)
    expect(focalPoint?.y).toBeLessThanOrEqual(1)
  })

  it('falls back to the exact centre for a flat image', async () => {
    const image = await sharp({
      create: {
        width: 1_000,
        height: 600,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toBuffer()

    await expect(computeFocalPoint(image)).resolves.toEqual({ x: 0.5, y: 0.5 })
  })

  it('returns null when sharp cannot read the image metadata', async () => {
    await expect(computeFocalPoint(Buffer.from('not an image'))).resolves.toBeNull()
  })

  /*
   * Reachable range, not accuracy.
   *
   * A probe reading is the CENTRE of a quarter-width slice, so a slice centre
   * can never sit closer to an edge than an eighth of the axis. Before the
   * rescale in `resolveAxis`, a subject flush against the left edge was stored
   * as 0.125 and rendered `object-position: 12.5%` — the frame still clipped
   * the subject, on exactly the images this feature exists to frame. It also
   * made `focalMiss = 1` unreachable in `cropDamage` for most sources.
   *
   * Bands rather than exact values: libvips attention weights move between
   * versions, so pinning a number here would make this a version test. What
   * must hold is that the ends of the interval are REACHABLE at all.
   */
  describe('reachable range', () => {
    it('drives a flush-left subject well below the 0.125 probe floor', async () => {
      const image = await makeImage({
        width: 1_000,
        height: 600,
        left: 0,
        top: 240,
        size: 120,
      })

      const focalPoint = await computeFocalPoint(image)

      expect(focalPoint).not.toBeNull()
      expect(focalPoint?.x).toBeLessThan(0.1)
      expect(focalPoint?.x).toBeGreaterThanOrEqual(0)
    })

    it('drives a flush-right subject well above the 0.875 probe ceiling', async () => {
      const image = await makeImage({
        width: 1_000,
        height: 600,
        left: 880,
        top: 240,
        size: 120,
      })

      const focalPoint = await computeFocalPoint(image)

      expect(focalPoint).not.toBeNull()
      expect(focalPoint?.x).toBeGreaterThan(0.9)
      expect(focalPoint?.x).toBeLessThanOrEqual(1)
    })

    it('drives a flush-top subject below the floor on the y axis too', async () => {
      const image = await makeImage({
        width: 600,
        height: 1_000,
        left: 240,
        top: 0,
        size: 120,
      })

      const focalPoint = await computeFocalPoint(image)

      expect(focalPoint).not.toBeNull()
      expect(focalPoint?.y).toBeLessThan(0.1)
      expect(focalPoint?.y).toBeGreaterThanOrEqual(0)
    })
  })

  /*
   * EXIF orientation.
   *
   * `downloadAndStoreImages` calls `computeFocalPoint(processed.buffer)` and
   * not on the source bytes, deliberately: `processImage` applies `.rotate()`,
   * so the stored asset — the one the browser renders and the one the focal
   * backfill re-downloads — can be in a different orientation than the source.
   * Nothing asserted that choice, so a refactor hoisting the call above the
   * rotation would silently mis-frame every EXIF-rotated photo, and the only
   * symptom would be off-centre crops on phone-camera images.
   *
   * Orientation 6 is "rotate 90 degrees clockwise to display", so a point
   * stored at (u, v) displays at (1 - v, u). The subject is placed top-left in
   * the STORED pixels (low u, low v), so it displays TOP-RIGHT — a correct
   * implementation must report a HIGH x and a LOW y.
   */
  it('measures the displayed orientation of an EXIF-rotated JPEG, not the stored one', async () => {
    const rotatedSource = await sharp({
      create: {
        width: 1_000,
        height: 600,
        channels: 3,
        background: { r: 24, g: 24, b: 24 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 120,
              height: 120,
              channels: 3,
              background: { r: 255, g: 40, b: 40 },
            },
          },
          left: 60,
          top: 60,
        },
      ])
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const processed = await processImage(rotatedSource, {
      maxWidth: 1600,
      maxHeight: 1600,
      maxFileSizeBytes: 30 * 1024 * 1024,
    })

    // Guard the guard: if sharp ever stopped honouring the orientation tag this
    // test would pass vacuously, so assert the rotation actually happened.
    expect(processed.width).toBe(600)
    expect(processed.height).toBe(1_000)

    const onProcessed = await computeFocalPoint(processed.buffer)
    const onSource = await computeFocalPoint(rotatedSource)

    expect(onProcessed).not.toBeNull()
    // (u, v) -> (1 - v, u): top-left in stored pixels displays top-right.
    expect(onProcessed?.x).toBeGreaterThan(0.6)
    expect(onProcessed?.y).toBeLessThan(0.4)

    // And the two readings genuinely differ, which is what makes the choice of
    // buffer in `downloadAndStoreImages` load-bearing rather than cosmetic.
    // Asserted on x, not y: BOTH readings sit low on y (the subject is top-left
    // in stored pixels and top-right once displayed), so only x separates the
    // rotated case from the unrotated one — a y assertion here would pass even
    // if someone hoisted the call above the rotation.
    expect(onSource).not.toBeNull()
    expect(onSource?.x).toBeLessThan(0.4)
  })
})
