import { describe, expect, it } from 'vitest'
import { parseDescriptionRewriteResult } from './description-rewrite'

describe('parseDescriptionRewriteResult', () => {
  it('returns null description when the LLM response is not valid JSON — never the raw text', () => {
    const result = parseDescriptionRewriteResult('抱歉，我無法解析，但這裡有超過二十個字元的原始輸出內容')
    expect(result.description).toBeNull()
  })

  it('maps free-text city names to DB slugs', () => {
    const json = JSON.stringify({
      description_zh: '品牌簡介',
      description_en: 'Brand description',
      blurb_zh: '摘要',
      blurb_en: 'Summary',
      price_range: 1,
      product_tags: [],
      product_tags_en: [],
      city: '台北',
      founding_year: null,
      signature_products: [],
      where_to_buy: null,
      category_mismatch: false,
    })
    const result = parseDescriptionRewriteResult(json)
    expect(result.city).toBe('taipei')
  })

  it('returns null city when the value cannot be mapped to a valid slug', () => {
    const json = JSON.stringify({
      description_zh: '品牌簡介',
      description_en: 'Brand description',
      blurb_zh: '摘要',
      blurb_en: 'Summary',
      price_range: 1,
      product_tags: [],
      product_tags_en: [],
      city: 'somewhere unknown',
      founding_year: null,
      signature_products: [],
      where_to_buy: null,
      category_mismatch: false,
    })
    const result = parseDescriptionRewriteResult(json)
    expect(result.city).toBeNull()
  })
})
