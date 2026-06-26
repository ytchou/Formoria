import { describe, it, expect } from 'vitest'
import { getEnrichmentStatus } from '../submissions-review-list'

describe('getEnrichmentStatus from enriched_data', () => {
  it('returns not_enriched when enriched_data is null', () => {
    const status = getEnrichmentStatus(null)
    expect(status).toBe('not_enriched')
  })

  it('returns partially_enriched when only some fields are present', () => {
    const status = getEnrichmentStatus({
      description: 'A brand',
    })
    expect(status).toBe('partially_enriched')
  })

  it('returns enriched when all key fields are present', () => {
    const status = getEnrichmentStatus({
      description: 'A brand',
      heroImageUrl: 'https://example.com/hero.jpg',
      productPhotos: ['photo1.jpg'],
      productType: 'crafts',
      tagSlugs: ['taiwan-crafts'],
    })
    expect(status).toBe('enriched')
  })
})
