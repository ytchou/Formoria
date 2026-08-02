import { describe, it, expect } from 'vitest'
import { buildCandidatePool } from './candidate-pool'

describe('buildCandidatePool', () => {
  it('unions scraped gallery + google results, dedupes by URL, tags source', () => {
    const pool = buildCandidatePool({
      scraped: ['https://a.com/1.jpg', 'https://a.com/2.jpg'],
      googleImages: ['https://a.com/2.jpg', 'https://b.com/3.jpg'],
    })
    expect(pool).toHaveLength(3)
    expect(pool.find((c) => c.url.endsWith('2.jpg'))!.source).toBe('scrape')
  })

  it('includes json_ld source between scrape and google_image, dedupes across all three', () => {
    const pool = buildCandidatePool({
      scraped: ['https://a.com/1.jpg'],
      jsonLdImages: ['https://a.com/1.jpg', 'https://b.com/2.jpg'],
      googleImages: ['https://b.com/2.jpg', 'https://c.com/3.jpg'],
    })
    expect(pool).toHaveLength(3)
    expect(pool[0]).toEqual({ url: 'https://a.com/1.jpg', source: 'scrape' })
    expect(pool[1]).toEqual({ url: 'https://b.com/2.jpg', source: 'json_ld' })
    expect(pool[2]).toEqual({ url: 'https://c.com/3.jpg', source: 'google_image' })
  })

  it('keeps Serper provenance on the provider-neutral candidate', () => {
    const pool = buildCandidatePool({
      scraped: [],
      googleImages: [
        {
          url: 'https://cdn.example.com/image.webp',
          sourceUrl: 'https://images.example.com/redirect',
          pageUrl: 'https://brand.example.com/products/one',
          previewUrl: 'https://cdn.example.com/thumb.webp',
          title: 'Brand product',
          providerSource: 'Brand website',
          domain: 'brand.example.com',
          position: 1,
          query: 'Brand products',
          auditResultId: 'audit-1',
          imageWidth: 1200,
          imageHeight: 900,
        },
      ],
    })

    expect(pool[0]).toMatchObject({
      source: 'google_image',
      sourceUrl: 'https://images.example.com/redirect',
      pageUrl: 'https://brand.example.com/products/one',
      providerSource: 'Brand website',
      auditResultId: 'audit-1',
      imageWidth: 1200,
    })
  })
})
