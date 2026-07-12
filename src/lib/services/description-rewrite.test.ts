import { describe, expect, it } from 'vitest'
import { parseDescriptionRewriteResult } from './description-rewrite'

function makeTagFixture(
  product_tags: string[],
  product_tags_en: string[],
): string {
  return JSON.stringify({
    description_zh: '品牌簡介',
    description_en: 'Brand description',
    blurb_zh: '摘要',
    blurb_en: 'Summary',
    price_range: 1,
    product_tags,
    product_tags_en,
    city: null,
    founding_year: null,
    signature_products: [],
    where_to_buy: null,
    category_mismatch: false,
  })
}

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

  it('normalizes product_tags against the vocabulary and collapses variants', () => {
    const json = makeTagFixture(
      ['側背包', '口金零錢包', '口金夾'],
      ['crossbody', 'clasp coin purse', 'clasp wallet'],
    )
    const result = parseDescriptionRewriteResult(json)
    // '側背包' is an alias for crossbody-bags (斜背包); '口金夾' dedupes to same slug as '口金零錢包'
    expect(result.productTags).toEqual(['斜背包', '口金包'])
    expect(result.productTagsEn).toEqual(['Crossbody Bags', 'Clasp-Frame Bags'])
  })

  it('keeps a single normalized tag (min-1 gate)', () => {
    const json = makeTagFixture(
      ['口金零錢包', '口金夾'],
      ['a', 'b'],
    )
    const result = parseDescriptionRewriteResult(json)
    // Both collapse to the same slug → one canonical tag
    // Old min-2 gate would have dropped it; min-1 gate preserves it
    expect(result.productTags).toEqual(['口金包'])
    expect(result.productTagsEn).toEqual(['Clasp-Frame Bags'])
  })

  it('drops blocklisted novel tags', () => {
    const json = makeTagFixture(
      ['藍鵲系列襪子'],
      ['bluebird series socks'],
    )
    const result = parseDescriptionRewriteResult(json)
    // '系列' matches BLOCKLIST_CONTENT → rejected
    expect(result.productTags).toEqual([])
    expect(result.rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: '藍鵲系列襪子', reason: 'blocklist' })]),
    )
  })
})
