import { describe, expect, it } from 'vitest'
import { enrichedDataFromDb, enrichedDataToDb } from '../enriched-data'

describe('enrichedDataFromDb', () => {
  it('maps price_range to priceRange', () => {
    expect(enrichedDataFromDb({ price_range: 2 })).toEqual({ priceRange: 2 })
  })

  it('maps product_tags to productTags', () => {
    expect(enrichedDataFromDb({ product_tags: ['skincare', 'refillable'] })).toEqual({
      productTags: ['skincare', 'refillable'],
    })
  })

  it('does not include brandHighlights', () => {
    expect(enrichedDataFromDb({ brand_highlights: 'Local materials' })).not.toHaveProperty(
      'brandHighlights'
    )
  })
})

describe('enrichedDataToDb', () => {
  it('maps priceRange to price_range', () => {
    expect(enrichedDataToDb({ priceRange: 2 })).toEqual({ price_range: 2 })
  })

  it('maps productTags to product_tags', () => {
    expect(enrichedDataToDb({ productTags: ['skincare', 'refillable'] })).toEqual({
      product_tags: ['skincare', 'refillable'],
    })
  })
})
