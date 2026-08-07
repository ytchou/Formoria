import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VISION_IMAGE_WIDTH,
  encodeVisionDownload,
  visionDataUri,
  visionStorageKey,
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

const SUPABASE_URL = 'https://xkcayngbttpxyibgzern.supabase.co'
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * DEV-1374: the loader shipped on the DELETE-path key helper, which accepts
 * `brands/` only. 23 queued `submission_images` rows carry a null
 * `storage_path` and a `submissions/` public URL, so they resolved to no key
 * and one submission's entire unclassified set failed on every run, forever.
 */
describe('visionStorageKey', () => {
  it('recovers a submissions/ key from a public URL with no storage_path', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)

    expect(
      visionStorageKey({
        storage_path: null,
        url: `${PUBLIC_PREFIX}submissions/4d3f/hero.webp`,
      }),
    ).toBe('submissions/4d3f/hero.webp')
  })

  it('recovers a brands/ key from a public URL with no storage_path', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)

    expect(
      visionStorageKey({
        storage_path: null,
        url: `${PUBLIC_PREFIX}brands/4d3f/hero.webp`,
      }),
    ).toBe('brands/4d3f/hero.webp')
  })

  it('prefers an explicit storage_path over the URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)

    expect(
      visionStorageKey({
        storage_path: ' submissions/stored/path.webp ',
        url: `${PUBLIC_PREFIX}brands/4d3f/hero.webp`,
      }),
    ).toBe('submissions/stored/path.webp')
  })

  it('has no key for an external hotlink', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)

    expect(
      visionStorageKey({ storage_path: null, url: 'https://cdn.example/x.jpg' }),
    ).toBeNull()
  })
})

/**
 * Every branch here must end in null rather than a throw: the caller reads null
 * as "requeue this row", and a thrown error would be recorded as a verdict —
 * the DEV-1255 failure that destroyed 18 live images.
 */
describe('encodeVisionDownload', () => {
  it('encodes a downloaded blob', async () => {
    const bytes = await solidImage(800, 800)
    const result = await encodeVisionDownload('brands/a/hero.webp', {
      data: new Blob([new Uint8Array(bytes)]),
      error: null,
    })

    expect(result?.startsWith(DATA_URI_PREFIX)).toBe(true)
  })

  it('returns null on a download error instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      encodeVisionDownload('brands/a/hero.webp', {
        data: null,
        error: new Error('service role key missing'),
      }),
    ).resolves.toBeNull()
    expect(error).toHaveBeenCalled()
  })

  it('returns null for an object over the size ceiling', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      encodeVisionDownload('brands/a/huge.webp', {
        data: new Blob([new Uint8Array(11 * 1024 * 1024)]),
        error: null,
      }),
    ).resolves.toBeNull()
    expect(error).toHaveBeenCalled()
  })

  it('returns null when the bytes are not a decodable image', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      encodeVisionDownload('brands/a/hero.webp', {
        data: new Blob([new TextEncoder().encode('not an image at all')]),
        error: null,
      }),
    ).resolves.toBeNull()
    expect(error).toHaveBeenCalled()
  })
})
