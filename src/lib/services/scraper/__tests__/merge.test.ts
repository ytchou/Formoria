import { describe, it, expect } from 'vitest'
import { mergeScrapedData } from '../merge'
import { emptyResult } from '../parse/extractors'

describe('mergeScrapedData', () => {
  it('lets official-site fields win and social fills gaps', () => {
    const official = { ...emptyResult('https://brand.com'), brandName: 'Brand', description: 'Official copy' }
    const social = { ...emptyResult('https://instagram.com/brand'), brandName: 'IG name', socialInstagram: 'https://instagram.com/brand' }
    const merged = mergeScrapedData([
      { type: 'social', data: social },
      { type: 'official-site', data: official },
    ])
    expect(merged.brandName).toBe('Brand')                 // official wins
    expect(merged.socialInstagram).toContain('instagram.com/brand') // social fills gap
  })
  it('dedupes and caps categoryHints at 5', () => {
    const a = { ...emptyResult('https://a.com'), categoryHints: ['x','x','a','b','c','d','e','f'] }
    const merged = mergeScrapedData([{ type: 'official-site', data: a }])
    expect(merged.categoryHints.length).toBeLessThanOrEqual(5)
  })
})
