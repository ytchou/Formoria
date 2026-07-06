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
})
