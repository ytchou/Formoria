import { describe, expect, it, vi } from 'vitest'
import { parseDescriptionRewriteResult, rewriteBrandDescription } from './description-rewrite'
import { createDeepSeekClient } from './deepseek-client'

vi.mock('./deepseek-client', async () => {
  const actual = await vi.importActual<typeof import('./deepseek-client')>('./deepseek-client')
  return { ...actual, createDeepSeekClient: vi.fn() }
})

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

  it('localizes zh reputation and FAQ fields while preserving English FAQ text', () => {
    const json = JSON.stringify({
      description_zh: '品牌簡介',
      description_en: 'Brand description',
      blurb_zh: '摘要',
      blurb_en: 'Summary',
      reputation_summary: {
        text: '這個品牌的視頻質量受到信息媒體關注',
        text_en: 'The brand received media attention.',
        sources: [{ url: 'https://example.com/review' }],
      },
      faq: [
        { category: 'products', question: '有哪些視頻產品？', answer: '提供高質量信息服務。' },
        { category: 'products', question: 'What products are available?', answer: 'The brand sells products.' },
      ],
      product_tags: [],
      product_tags_en: [],
      city: null,
      founding_year: null,
    })

    const result = parseDescriptionRewriteResult(json)

    expect(result.reputationSummary?.text).toBe('這個品牌的影片品質受到資訊媒體關注')
    expect(result.faq).toEqual([
      { category: 'products', question: '有哪些影片產品？', answer: '提供高品質資訊服務。' },
      { category: 'products', question: 'What products are available?', answer: 'The brand sells products.' },
    ])
  })

  it('sanitizes input artifacts and localizes accepted zh fields', async () => {
    const descriptionZh = `信息設計坊${'這個視頻質量很高，信息豐富。'.repeat(20)}`
    const blurbZh = `信息設計坊${'視頻質量很好。'.repeat(8)}`
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: 'This brand makes durable goods. '.repeat(10),
        blurb_zh: blurbZh,
        blurb_en: 'A durable Taiwanese brand for everyday goods.',
        product_tags: [],
        product_tags_en: [],
        city: null,
        founding_year: null,
      }),
    })
    vi.mocked(createDeepSeekClient).mockReturnValue({ chat } as never)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')

    const output = await rewriteBrandDescription(
      '信息設計坊',
      null,
      ['摘要 https://example.com?utm_source=chatgpt.com&ref=1 turn0search0'],
      '網站內容 citeturn0news2 https://example.com?utm_source=openai',
    )

    const request = chat.mock.calls.at(0)?.[0]
    expect(request?.user).not.toContain('utm_source=chatgpt.com')
    expect(request?.user).not.toContain('turn0search0')
    expect(request?.user).not.toContain('citeturn0news2')
    expect(request?.user).toContain('https://example.com?ref=1')
    expect(output?.result.description_zh?.startsWith('信息設計坊')).toBe(true)
    expect(output?.result.description_zh).toContain('影片')
    expect(output?.result.description_zh).toContain('品質')
    expect(output?.result.description_zh).toContain('資訊')
    expect(output?.result.blurb_zh?.startsWith('信息設計坊')).toBe(true)
  })
})
