import { describe, expect, it } from 'vitest'
import { buildImageProviderMetadata, isNonImageContentType } from './image-download'

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
