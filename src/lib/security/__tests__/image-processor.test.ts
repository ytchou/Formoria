import { describe, it, expect } from 'vitest'
import { processImage, DEFAULT_CONFIG } from '../image-processor'
import sharp from 'sharp'

async function createTestImage(
  format: 'jpeg' | 'png' | 'webp',
  width = 100,
  height = 100
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .toFormat(format)
    .toBuffer()
}

describe('processImage', () => {
  it('accepts and re-encodes a valid JPEG to WebP', async () => {
    const jpeg = await createTestImage('jpeg')
    const result = await processImage(jpeg)
    expect(result.contentType).toBe('image/webp')
    expect(result.width).toBeLessThanOrEqual(DEFAULT_CONFIG.maxWidth)
    expect(result.height).toBeLessThanOrEqual(DEFAULT_CONFIG.maxHeight)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('accepts PNG and WebP inputs', async () => {
    const png = await createTestImage('png')
    const resultPng = await processImage(png)
    expect(resultPng.contentType).toBe('image/webp')

    const webp = await createTestImage('webp')
    const resultWebp = await processImage(webp)
    expect(resultWebp.contentType).toBe('image/webp')
  })

  it('rejects files exceeding max size', async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 0xff)
    await expect(processImage(oversized)).rejects.toThrow(/size/i)
  })

  it('rejects input above the configured maxFileSizeBytes', async () => {
    const buf = Buffer.alloc(6 * 1024 * 1024, 1)
    await expect(
      processImage(buf, { maxFileSizeBytes: 5 * 1024 * 1024 })
    ).rejects.toThrow()
  })

  it('rejects non-image files with wrong magic bytes', async () => {
    const textFile = Buffer.from('This is not an image file at all')
    await expect(processImage(textFile)).rejects.toThrow(/format/i)
  })

  it('resizes images exceeding max dimensions', async () => {
    const large = await createTestImage('jpeg', 2400, 1800)
    const result = await processImage(large)
    expect(result.width).toBeLessThanOrEqual(DEFAULT_CONFIG.maxWidth)
    expect(result.height).toBeLessThanOrEqual(DEFAULT_CONFIG.maxHeight)
  })

  it('honors config overrides for max dimensions and max input size', async () => {
    const big = await sharp({
      create: {
        width: 2000,
        height: 1400,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer()

    const result = await processImage(big, {
      maxWidth: 1600,
      maxHeight: 1600,
      maxFileSizeBytes: 40 * 1024 * 1024,
    })

    expect(result.contentType).toBe('image/webp')
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1600)
    expect(Math.max(result.width, result.height)).toBeGreaterThan(1200)
  })

  it('does not enlarge small images', async () => {
    const small = await createTestImage('jpeg', 50, 50)
    const result = await processImage(small)
    expect(result.width).toBe(50)
    expect(result.height).toBe(50)
  })

  it('strips EXIF metadata', async () => {
    const jpeg = await createTestImage('jpeg')
    const result = await processImage(jpeg)
    const metadata = await sharp(result.buffer).metadata()
    expect(metadata.exif).toBeUndefined()
  })
})
