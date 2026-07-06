import { describe, it, expect } from 'vitest'
import { parseClassification, applyClassifications } from './classify-images'

describe('parseClassification', () => {
  it('parses a vision response into tags/score/alt', () => {
    const r = parseClassification('{tag:product,score:88,alt_zh:木製餐盤,alt_en:Wooden plate}')
    expect(r).toEqual({ tag: 'product', score: 88, altZh: '木製餐盤', altEn: 'Wooden plate' })
  })
  it('returns null classification (not a throw) on malformed response', () => {
    expect(parseClassification('cannot classify')).toBeNull()
  })
})

describe('applyClassifications', () => {
  it('rejects junk tags and orders the rest by score; hero = best product/lifestyle', () => {
    const images = [
      { id: '1', tag: 'promo', score: 95 },
      { id: '2', tag: 'product', score: 80 },
      { id: '3', tag: 'lifestyle', score: 90 },
    ]
    const result = applyClassifications(images as never)
    expect(result.rejectedIds).toEqual(['1'])
    expect(result.ordered.map((i) => i.id)).toEqual(['3', '2'])
  })
})
