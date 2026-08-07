import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  VISION_IMAGE_WIDTH,
  visionDataUri,
} from './vision-image'

const DATA_URI_PREFIX = 'data:image/webp;base64,'

async function solidImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 90, b: 60 },
    },
  })
    .jpeg()
    .toBuffer()
}

function decode(dataUri: string): Buffer {
  return Buffer.from(dataUri.slice(DATA_URI_PREFIX.length), 'base64')
}

/**
 * These lock eval parity, not encoder mechanics. Production and
 * `scripts/model-ab/run.ts` share this function precisely so the model sees the
 * same picture in both; a silent change to the width or the format would make
 * the harness stop predicting production without any test going red.
 */
describe('visionDataUri', () => {
  it('downscales a large image to a 512px webp data URI', async () => {
    const result = await visionDataUri(await solidImage(1600, 1600))

    expect(result.startsWith(DATA_URI_PREFIX)).toBe(true)

    const metadata = await sharp(decode(result)).metadata()
    expect(metadata.width).toBe(VISION_IMAGE_WIDTH)
    expect(metadata.format).toBe('webp')
  })

  it('never upscales a source narrower than the cap', async () => {
    const result = await visionDataUri(await solidImage(200, 200))

    const metadata = await sharp(decode(result)).metadata()
    expect(metadata.width).toBe(200)
  })

  it('rejects on bytes that are not an image', async () => {
    await expect(
      visionDataUri(Buffer.from('not an image at all')),
    ).rejects.toThrow()
  })
})
