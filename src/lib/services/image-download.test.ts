import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  applyProductionImageGates,
  buildImageProviderMetadata,
  imageRejectionCode,
  isNonImageContentType,
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
