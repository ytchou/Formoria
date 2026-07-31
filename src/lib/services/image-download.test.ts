import { describe, expect, it } from 'vitest'
import { buildImageProviderMetadata } from './image-download'

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
