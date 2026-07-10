import { describe, it, expect } from 'vitest'
import { parseClassification, parseClassificationBatch, applyClassifications } from './classify-images'

describe('parseClassification', () => {
  it('parses a vision response into tags/score/alt', () => {
    const r = parseClassification('{tag:product,score:88,alt_zh:木製餐盤,alt_en:Wooden plate}')
    expect(r).toEqual({ tag: 'product', score: 88, altZh: '木製餐盤', altEn: 'Wooden plate' })
  })
  it('parses strict JSON from GPT-4o-mini', () => {
    const r = parseClassification('{"tag":"lifestyle","score":72,"alt_zh":"戶外背包","alt_en":"Outdoor backpack"}')
    expect(r).toEqual({ tag: 'lifestyle', score: 72, altZh: '戶外背包', altEn: 'Outdoor backpack' })
  })
  it('returns null classification (not a throw) on malformed response', () => {
    expect(parseClassification('cannot classify')).toBeNull()
  })
})

describe('parseClassificationBatch', () => {
  it('parses a bare JSON array', () => {
    const input = '[{"tag":"product","score":85,"alt_zh":"背包","alt_en":"Backpack"}]'
    const results = parseClassificationBatch(input, 1)
    expect(results).toHaveLength(1)
    expect(results[0]?.tag).toBe('product')
  })
  it('unwraps object-wrapped array from OpenAI JSON mode', () => {
    const input = '{"classifications":[{"tag":"lifestyle","score":72,"alt_zh":"戶外","alt_en":"Outdoor"},{"tag":"packaging","score":60,"alt_zh":"盒裝","alt_en":"Box"}]}'
    const results = parseClassificationBatch(input, 2)
    expect(results).toHaveLength(2)
    expect(results[0]?.tag).toBe('lifestyle')
    expect(results[1]?.tag).toBe('packaging')
  })
  it('handles flat object for single-image batch', () => {
    const input = '{"tag":"product","score":90,"alt_zh":"登山背包","alt_en":"Hiking backpack"}'
    const results = parseClassificationBatch(input, 1)
    expect(results).toHaveLength(1)
    expect(results[0]?.tag).toBe('product')
    expect(results[0]?.score).toBe(90)
  })
  it('returns nulls on non-JSON input', () => {
    const results = parseClassificationBatch('not json', 3)
    expect(results).toEqual([null, null, null])
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
