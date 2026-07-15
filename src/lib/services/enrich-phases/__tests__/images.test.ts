import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBrandImagePhase } from '../images'
import type { EnrichBrand, EnrichPhase } from '../types'
import { downloadAndStoreImages } from '../../image-download'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  downloadAndStoreImages: vi.fn(),
  processImage: vi.fn(),
  storageRemove: vi.fn(),
  storageUpload: vi.fn(),
  tableUpsert: vi.fn(),
}))

vi.mock('../../image-download', () => ({
  downloadAndStoreImages: mocks.downloadAndStoreImages,
}))

vi.mock('@/lib/security/image-processor', () => ({
  processImage: mocks.processImage,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  hero_image_url: null,
}

describe('runBrandImagePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns skipped when images is not in requested phases', async () => {
    const result = await runBrandImagePhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      imageSearchUrls: ['https://example.com/image.jpg'],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns skipped when no image URLs available', async () => {
    const result = await runBrandImagePhase({
      brand,
      phases: ['images'] as EnrichPhase[],
      imageSearchUrls: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.detail).toContain('no image')
    expect(result.patch).toEqual({})
  })

  it('stores submission enrichment images against the submission target', async () => {
    vi.mocked(downloadAndStoreImages).mockResolvedValue([
      'https://example.com/stored.jpg',
    ])

    await runBrandImagePhase({
      brand,
      phases: ['images'] as EnrichPhase[],
      imageSearchUrls: ['https://example.com/image.jpg'],
      target: { type: 'submission', id: 'submission-1' },
    })

    expect(downloadAndStoreImages).toHaveBeenCalledWith(
      ['https://example.com/image.jpg'],
      { type: 'submission', id: 'submission-1' },
    )
  })
})

async function createImageFixture(format: 'gif' | 'png'): Promise<Buffer> {
  const width = 500
  const height = 500
  const channels = 3
  const pixels = Buffer.alloc(width * height * channels)
  for (let index = 0; index < pixels.length; index++) {
    pixels[index] = (index * 31 + Math.floor(index / 997) * 17) % 256
  }

  const image = sharp(pixels, { raw: { width, height, channels } })
  return format === 'gif' ? image.gif().toBuffer() : image.png().toBuffer()
}

function stubImageFetch(buffer: Buffer, contentType: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': contentType }),
    blob: async () => new Blob([Uint8Array.from(buffer)]),
  } as Response))
}

function createSupabaseMock() {
  const hashQuery = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        not: vi.fn().mockResolvedValue({ data: [] }),
      })),
    })),
    upsert: mocks.tableUpsert,
  }
  const bucket = {
    getPublicUrl: vi.fn((filename: string) => ({
      data: { publicUrl: `https://example.com/${filename}` },
    })),
    remove: mocks.storageRemove,
    upload: mocks.storageUpload,
  }

  return {
    from: vi.fn(() => hashQuery),
    storage: { from: vi.fn(() => bucket) },
  }
}

async function callActualDownload(...args: Parameters<typeof downloadAndStoreImages>) {
  const actual = await vi.importActual<typeof import('../../image-download')>(
    '../../image-download'
  )
  return actual.downloadAndStoreImages(...args)
}

describe('downloadAndStoreImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServiceClient.mockReturnValue(createSupabaseMock())
    mocks.storageUpload.mockResolvedValue({ error: null })
    mocks.storageRemove.mockResolvedValue({ error: null })
    mocks.tableUpsert.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('re-encodes downloaded images through processImage and uploads webp with 1-year cache', async () => {
    const originalBuffer = await createImageFixture('png')
    const processedBuffer = Buffer.from('webp')
    stubImageFetch(originalBuffer, 'image/png')
    mocks.processImage.mockResolvedValue({
      buffer: processedBuffer,
      contentType: 'image/webp',
      width: 1600,
      height: 1000,
      originalSize: 500_000,
      processedSize: 90_000,
    })

    await callActualDownload(['https://example.com/image.png'], brand.id)

    expect(mocks.processImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        maxWidth: 1600,
        maxHeight: 1600,
        maxFileSizeBytes: 30 * 1024 * 1024,
      })
    )
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/\.webp$/),
      processedBuffer,
      expect.objectContaining({
        contentType: 'image/webp',
        cacheControl: '31536000',
      })
    )
    expect(mocks.tableUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1600, height: 1000 }),
      expect.anything()
    )
  })

  it('drops GIF candidates — processImage rejects unsupported formats', async () => {
    const gifBuffer = await createImageFixture('gif')
    stubImageFetch(gifBuffer, 'image/gif')
    mocks.processImage.mockRejectedValue(
      new Error('Unsupported image format: gif. Allowed formats: jpeg, png, webp')
    )

    const result = await callActualDownload(
      ['https://example.com/image.gif'],
      brand.id
    )

    expect(mocks.processImage).toHaveBeenCalled()
    expect(result[0]).toBeNull()
    expect(mocks.storageUpload).not.toHaveBeenCalled()
  })

  it('skips the candidate when processImage throws', async () => {
    const originalBuffer = await createImageFixture('png')
    stubImageFetch(originalBuffer, 'image/png')
    mocks.processImage.mockRejectedValue(new Error('bad image'))

    const result = await callActualDownload(
      ['https://example.com/image.png'],
      brand.id
    )

    expect(result[0]).toBeNull()
    expect(mocks.storageUpload).not.toHaveBeenCalled()
  })
})
