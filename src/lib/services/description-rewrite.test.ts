import { describe, expect, it, vi } from 'vitest'
import { parseDescriptionRewriteResult, rewriteBrandDescription } from './description-rewrite'
import { createAuditedDeepSeekClient } from './llm-audit'

vi.mock('./llm-audit', () => ({ createAuditedDeepSeekClient: vi.fn() }))

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
    vi.mocked(createAuditedDeepSeekClient).mockReturnValue({ chat } as never)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')

    const output = await rewriteBrandDescription(
      '信息設計坊',
      null,
      ['摘要 https://example.com?utm_source=chatgpt.com&ref=1 turn0search0'],
      '網站內容 citeturn0news2 https://example.com?utm_source=openai',
      {
        jobId: 'job-1',
        target: { type: 'brand', id: 'brand-1' },
      },
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
    expect(createAuditedDeepSeekClient).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', phase: 'description', target: { type: 'brand', id: 'brand-1' } }),
      { apiKey: 'test-key' },
    )
  })

  it('retries when generated descriptions contain pricing information', async () => {
    const cleanDescriptionZh = '品牌以台灣製鞋工藝為核心，從打版、看樣到量產皆由團隊親自監督，產品聚焦於簡約舒適的帆布鞋與防水系列，並透過材質選擇與結構調整回應日常穿著需求。'.repeat(3)
    const cleanDescriptionEn = 'The brand develops canvas sneakers in Taiwan, overseeing pattern making, sample reviews, and production while refining materials and construction for comfortable everyday wear. '.repeat(3).trim()
    const blurbZh = '從打版到量產皆親自把關，以台灣製鞋工藝打造簡約舒適的日常帆布鞋。'
    const blurbEn = 'Taiwan-made canvas sneakers shaped by close oversight from pattern making through production.'
    const response = (
      descriptionZh: string,
      descriptionEn: string,
      options: { blurbZh?: string; blurbEn?: string; priceRange?: 1 | 2 | 3 | null } = {},
    ) => ({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: descriptionEn,
        blurb_zh: options.blurbZh ?? blurbZh,
        blurb_en: options.blurbEn ?? blurbEn,
        price_range: options.priceRange === undefined ? 2 : options.priceRange,
        product_tags: [],
        product_tags_en: [],
        city: null,
        founding_year: null,
      }),
    })
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          `${cleanDescriptionZh}鞋款價格約 NT$1,316 至 NT$2,980。`,
          `${cleanDescriptionEn} Products are priced around NT$1,316 to NT$2,980.`,
          {
            blurbZh: `${blurbZh} 售價約 NT$1,316 起。`,
            blurbEn: `${blurbEn} Priced from NT$1,316.`,
            priceRange: 2,
          },
        ),
      )
      .mockResolvedValueOnce(
        response(cleanDescriptionZh, cleanDescriptionEn, { priceRange: null }),
      )
    vi.mocked(createAuditedDeepSeekClient).mockReturnValue({ chat } as never)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')

    const output = await rewriteBrandDescription(
      'Southgate 南登機口',
      null,
      ['品牌以帆布鞋為核心產品。'],
      null,
      { jobId: 'job-1', target: { type: 'brand', id: 'brand-1' } },
    )

    expect(chat).toHaveBeenCalledTimes(2)
    expect(chat.mock.calls[0]?.[0].system).toContain('不得包含價格資訊')
    expect(output?.attempts[0]?.validationRejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'description_zh', reasons: ['pricing_information'] }),
        expect.objectContaining({ field: 'description_en', reasons: ['pricing_information'] }),
        expect.objectContaining({ field: 'blurb_zh', reasons: ['pricing_information'] }),
        expect.objectContaining({ field: 'blurb_en', reasons: ['pricing_information'] }),
      ]),
    )
    expect(output?.result.description_zh).toBe(cleanDescriptionZh)
    expect(output?.result.description_en).toBe(cleanDescriptionEn)
    expect(output?.result.priceRange).toBe(2)
  })

  it('keeps non-pricing financial achievements in descriptions', async () => {
    const descriptionZh = `${'品牌以台灣工藝開發日常用品，從材料選擇、打樣到生產皆由團隊持續調整，並與在地供應夥伴合作，建立穩定且可追溯的製作流程。'.repeat(3)}品牌曾透過群眾集資募得新台幣5,000,000元，用於擴大產品開發。`
    const descriptionEn = `${'The brand develops everyday goods in Taiwan, refining materials, prototypes, and production with local partners to maintain a stable and traceable manufacturing process. '.repeat(3)}Its crowdfunding campaign raised NT$5 million to expand product development.`
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        description_zh: descriptionZh,
        description_en: descriptionEn,
        blurb_zh: '以台灣工藝開發日常用品，串連在地供應夥伴建立穩定且可追溯的製作流程，持續改善產品品質。',
        blurb_en: 'Taiwan-made everyday goods developed through a stable, traceable process with local partners.',
        price_range: null,
        product_tags: [],
        product_tags_en: [],
        city: null,
        founding_year: null,
      }),
    })
    vi.mocked(createAuditedDeepSeekClient).mockReturnValue({ chat } as never)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')

    const output = await rewriteBrandDescription(
      '集資品牌',
      null,
      ['品牌完成群眾集資。'],
      null,
      { jobId: 'job-1', target: { type: 'brand', id: 'brand-1' } },
    )

    expect(chat).toHaveBeenCalledTimes(1)
    expect(output?.result.description_zh).toContain('新台幣5,000,000元')
    expect(output?.result.description_en).toContain('raised NT$5 million')
  })
})
