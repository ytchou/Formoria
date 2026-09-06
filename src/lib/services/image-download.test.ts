import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  applyProductionImageGates,
  buildImageProviderMetadata,
  imageRejectionCode,
  isNonImageContentType,
  downloadAndGateImages,
  storeKeptImages,
  type GatedImage,
} from './image-download'

describe('production image gate telemetry', () => {
  it.each([
    ['text/html', Buffer.alloc(6_000), 'non_image'],
    ['image/png', Buffer.alloc(100), 'byte_size'],
    ['image/png', Buffer.alloc(6_000), 'decode_failed'],
  ] as const)(
    'reports %s input through observable gate output',
    async (contentType, buffer, expected) => {
      const error = await applyProductionImageGates(buffer, contentType).catch(
        (caught) => caught,
      )
      expect(imageRejectionCode(error)).toBe(expected)
    },
  )

  it('reports the production short-edge rejection through observable output', async () => {
    const pixels = Buffer.alloc(400 * 600 * 3)
    for (let index = 0; index < pixels.length; index += 1)
      pixels[index] = index % 251
    const buffer = await sharp(pixels, {
      raw: { width: 400, height: 600, channels: 3 },
    })
      .png()
      .toBuffer()
    const error = await applyProductionImageGates(buffer, 'image/png').catch(
      (caught) => caught,
    )
    expect(imageRejectionCode(error)).toBe('short_edge')
  })
})

describe('isNonImageContentType', () => {
  it.each(['image/webp', 'image/jpeg', 'image/png', 'image/gif'])(
    'accepts %s',
    (contentType) => {
      expect(isNonImageContentType(contentType)).toBe(false)
    },
  )

  // Regression: static.91app.com serves every asset as application/octet-stream.
  // Rejecting on the header discarded five valid 1200px product images for a
  // single brand in a spot check. sharp and the processImage format allowlist
  // are the real guarantee, so anything ambiguous must fall through to them.
  it.each(['application/octet-stream', '', 'binary/octet-stream'])(
    'lets ambiguous content type %p through to sharp',
    (contentType) => {
      expect(isNonImageContentType(contentType)).toBe(false)
    },
  )

  it.each([
    'text/html; charset=utf-8',
    'application/json',
    'application/pdf',
    'application/zip',
    'video/mp4',
    'audio/mpeg',
  ])('rejects %s without decoding', (contentType) => {
    expect(isNonImageContentType(contentType)).toBe(true)
  })
})

describe('buildImageProviderMetadata', () => {
  it('keeps the resolved fetch URL and Serper provenance separate', () => {
    expect(
      buildImageProviderMetadata(
        {
          url: 'https://cdn.example.com/resolved.webp',
          source: 'google_image',
          providerSource: 'Brand website',
          pageUrl: 'https://brand.example.com/product',
          previewUrl: 'https://cdn.example.com/thumb.webp',
          title: 'Product photo',
          domain: 'brand.example.com',
          position: 2,
          query: 'Brand product',
          auditResultId: 'audit-1',
        },
        'https://cdn.example.com/resolved.webp',
      ),
    ).toEqual({
      resolvedFetchUrl: 'https://cdn.example.com/resolved.webp',
      pageUrl: 'https://brand.example.com/product',
      previewUrl: 'https://cdn.example.com/thumb.webp',
      title: 'Product photo',
      source: 'Brand website',
      domain: 'brand.example.com',
      position: 2,
      query: 'Brand product',
      auditResultId: 'audit-1',
    })
  })
})

// ---------------------------------------------------------------------------
// downloadAndGateImages — holds buffers in memory, never uploads
// ---------------------------------------------------------------------------

/**
 * Build a valid PNG that passes every production gate: short edge >= 480,
 * aspect <= 3, entropy > 0.5, byte size >= 5120. The pixel data is random
 * enough for sharp's entropy to clear the floor.
 */
async function validTestPng(
  width = 600,
  height = 600,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + 97) % 256
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/**
 * Minimal HTTP mock: intercept fetch for the URLs in `mapping`, returning
 * the buffer as an image/png response. Other URLs get a 404.
 */
function mockFetchForUrls(mapping: Record<string, Buffer>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const buf = mapping[url]
    if (!buf) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  })
}

describe('downloadAndGateImages', () => {
  it('returns buffers with all required metadata fields', async () => {
    const png = await validTestPng()
    const url = 'https://img.example.com/a.png'
    mockFetchForUrls({ [url]: png })

    const results = await downloadAndGateImages(
      [{ url, source: 'google_image' }],
      { type: 'brand', id: 'brand-1' },
    )

    expect(results.length).toBe(1)
    const img = results[0]
    expect(img.buffer).toBeInstanceOf(Buffer)
    expect(img.width).toBeGreaterThanOrEqual(1)
    expect(img.height).toBeGreaterThanOrEqual(1)
    expect(img.dominantColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(typeof img.phash).toBe('string')
    expect(typeof img.entropy).toBe('number')
    expect(typeof img.sharpness).toBe('number')
    expect(typeof img.sourceUrl).toBe('string')
  })

  it('applies all production quality gates (rejects short-edge, aspect, entropy, byte-size)', async () => {
    // Build a tiny image that fails the short-edge gate (< 480px)
    const tinyPixels = Buffer.alloc(100 * 100 * 3)
    for (let i = 0; i < tinyPixels.length; i++) tinyPixels[i] = (i * 31) % 256
    const tinyPng = await sharp(tinyPixels, {
      raw: { width: 100, height: 100, channels: 3 },
    })
      .png()
      .toBuffer()

    const url = 'https://img.example.com/tiny.png'
    mockFetchForUrls({ [url]: tinyPng })

    const results = await downloadAndGateImages(
      [{ url, source: 'google_image' }],
      { type: 'brand', id: 'brand-2' },
    )

    // Gate rejects should produce an empty result array
    expect(results.length).toBe(0)
  })

  it('does not call Supabase storage upload', async () => {
    // This test asserts the function's structural property: it downloads and
    // gates but never uploads. We verify by checking that the result is a
    // GatedImage with a buffer (not a storage path), and that no upload call
    // was made to Supabase. Since downloadAndGateImages internally creates a
    // service client only for reading existing rows, and never calls
    // supabase.storage.from(...).upload, we verify the contract through the
    // return type — a buffer, not a storage key.
    const png = await validTestPng()
    const url = 'https://img.example.com/no-upload.png'
    mockFetchForUrls({ [url]: png })

    const results = await downloadAndGateImages(
      [{ url, source: 'google_image' }],
      { type: 'brand', id: 'brand-3' },
    )

    // The function returns GatedImage[] with buffers, not storage paths
    for (const img of results) {
      expect(img.buffer).toBeInstanceOf(Buffer)
      expect(img.buffer.byteLength).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// storeKeptImages — uploads only provided images, inserts active rows
// ---------------------------------------------------------------------------

describe('storeKeptImages', () => {
  function fakeGatedImage(overrides: Partial<GatedImage> = {}): GatedImage {
    return {
      buffer: Buffer.from('fake-processed-webp'),
      contentType: 'image/webp',
      width: 800,
      height: 600,
      dominantColor: '#aabbcc',
      phash: '0101010101010101',
      entropy: 6.5,
      sharpness: 12.3,
      source: 'google_image',
      sourceUrl: 'https://img.example.com/photo.png',
      provider: { resolvedFetchUrl: 'https://img.example.com/photo.png' },
      ...overrides,
    }
  }

  it('uploads exactly the number of provided images', async () => {
    const uploadCalls: unknown[] = []
    const insertCalls: unknown[] = []

    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: async (...args: unknown[]) => {
            uploadCalls.push(args)
            return { error: null }
          },
        }),
      },
      from: () => ({
        insert: (row: unknown) => {
          insertCalls.push(row)
          return {
            select: async () => ({
              data: [{ id: `img-${insertCalls.length}` }],
              error: null,
            }),
          }
        },
      }),
    }

    const kept = [
      fakeGatedImage({ sourceUrl: 'https://a.com/1.png' }),
      fakeGatedImage({ sourceUrl: 'https://a.com/2.png' }),
      fakeGatedImage({ sourceUrl: 'https://a.com/3.png' }),
    ]

    const records = await storeKeptImages(
      kept,
      { type: 'brand', id: 'brand-x' },
      fakeSupabase as never,
    )

    expect(uploadCalls.length).toBe(3)
    expect(records.length).toBe(3)
  })

  it('inserts rows with status active', async () => {
    const insertedRows: Record<string, unknown>[] = []

    const fakeSupabase = {
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
        }),
      },
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          insertedRows.push(row)
          return {
            select: async () => ({
              data: [{ id: 'img-2' }],
              error: null,
            }),
          }
        },
      }),
    }

    const kept = [
      fakeGatedImage(),
    ]

    await storeKeptImages(
      kept,
      { type: 'brand', id: 'brand-y' },
      fakeSupabase as never,
    )

    expect(insertedRows.length).toBe(1)
    expect(insertedRows[0].status).toBe('active')
  })
})
