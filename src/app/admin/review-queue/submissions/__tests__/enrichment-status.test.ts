import { describe, it, expect } from 'vitest'
import { getEnrichmentStatus } from '../submissions-review-list'

describe('getEnrichmentStatus', () => {
  it('returns "not_enriched" when enrichment is null', () => {
    expect(getEnrichmentStatus(null)).toBe('not_enriched')
  })

  it('returns "not_enriched" when enrichment is undefined', () => {
    expect(getEnrichmentStatus(undefined)).toBe('not_enriched')
  })

  it('returns "enriched" when all key fields are present', () => {
    const enrichment = {
      productType: 'food',
      heroImageUrl: 'https://example.com/img.jpg',
      tagSlugs: ['organic', 'local'],
      productPhotos: [],
    }
    expect(getEnrichmentStatus(enrichment)).toBe('enriched')
  })

  it('returns "partially_enriched" when heroImageUrl is missing', () => {
    const enrichment = {
      productType: 'food',
      heroImageUrl: null,
      tagSlugs: ['organic'],
      productPhotos: [],
    }
    expect(getEnrichmentStatus(enrichment)).toBe('partially_enriched')
  })

  it('returns "partially_enriched" when tagSlugs is empty', () => {
    const enrichment = {
      productType: 'food',
      heroImageUrl: 'https://example.com/img.jpg',
      tagSlugs: [],
      productPhotos: [],
    }
    expect(getEnrichmentStatus(enrichment)).toBe('partially_enriched')
  })

  it('returns "partially_enriched" when productType is empty', () => {
    const enrichment = {
      productType: '',
      heroImageUrl: 'https://example.com/img.jpg',
      tagSlugs: ['organic'],
      productPhotos: [],
    }
    expect(getEnrichmentStatus(enrichment)).toBe('partially_enriched')
  })
})
