import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

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
    expect(focalPoint?.x).toBeGreaterThan(0.7)
    expect(focalPoint?.x).toBeLessThan(0.98)
    expect(focalPoint?.y).toBeGreaterThan(0.65)
    expect(focalPoint?.y).toBeLessThan(0.98)
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
})
