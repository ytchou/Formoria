import { describe, expect, it } from 'vitest'

/**
 * The enrichment → `brand_faq` write. Two rules carry the risk here: the
 * bilingual pairing (the model emits a flat zh-then-en list, the table stores
 * one bilingual object per column) and fill-gaps-only (a populated column may
 * be hand-edited copy, and this runs again on every refresh apply).
 *
 * The Supabase client is injected as a query double rather than mocked —
 * `scripts/check-test-boundaries.mjs` forbids mocking `@/lib/supabase/server`.
 */
import {
  buildFaqColumnsFromEnrichment,
  upsertBrandFaqFromEnrichment,
} from '../brand-faq'
import type { EnrichedFaqItem } from '@/lib/types/enriched-data'

type FaqClient = NonNullable<Parameters<typeof upsertBrandFaqFromEnrichment>[2]>

type UpsertCall = {
  table: string
  payload: Record<string, unknown>
  options: unknown
}

type ReadCall = { table: string; brandId: string }

function createClientDouble(existingRow: Record<string, unknown> | null) {
  const upserts: UpsertCall[] = []
  const reads: ReadCall[] = []

  const client = {
    from(table: string) {
      const call: ReadCall = { table, brandId: '' }
      const builder = {
        select() {
          return builder
        },
        eq(_column: string, value: string) {
          call.brandId = String(value)
          return builder
        },
        async maybeSingle() {
          reads.push({ ...call })
          return { data: existingRow, error: null }
        },
        async upsert(payload: Record<string, unknown>, options: unknown) {
          upserts.push({ table, payload, options })
          return { error: null }
        },
      }
      return builder
    },
  }

  return { client: client as unknown as FaqClient, upserts, reads }
}

function item(
  category: string,
  question: string,
  answer: string,
): EnrichedFaqItem {
  return { category, question, answer }
}

const PRODUCTS_PAIR = [
  item('products', '這個品牌的主要產品有哪些？', '皮件與帆布包。'),
  item('products', 'What are the main products?', 'Leather goods and totes.'),
]

const PRICE_PAIR = [
  item('price', '價格帶是多少？', 'NT$1,200 起。'),
  item('price', 'What is the price range?', 'From NT$1,200.'),
]

describe('buildFaqColumnsFromEnrichment', () => {
  it('pairs zh and en items of the same category into one column entry', () => {
    const columns = buildFaqColumnsFromEnrichment([
      ...PRODUCTS_PAIR,
      ...PRICE_PAIR,
    ])

    expect(columns.faq_products).toEqual({
      question_zh: '這個品牌的主要產品有哪些？',
      answer_zh: '皮件與帆布包。',
      question_en: 'What are the main products?',
      answer_en: 'Leather goods and totes.',
    })
    expect(columns.faq_price).toEqual({
      question_zh: '價格帶是多少？',
      answer_zh: 'NT$1,200 起。',
      question_en: 'What is the price range?',
      answer_en: 'From NT$1,200.',
    })
  })

  it('maps every fixed category onto its column', () => {
    const columns = buildFaqColumnsFromEnrichment([
      item('where_to_buy', '哪裡買得到？', '官網與 Pinkoi。'),
      item('founded', '什麼時候成立的？', '2018 年。'),
      item('reputation', '評價如何？', '回購率高。'),
    ])

    expect(Object.keys(columns).sort()).toEqual([
      'faq_founded',
      'faq_reputation',
      'faq_where_to_buy',
    ])
  })

  it('keeps a half-written pair instead of dropping the answered locale', () => {
    // A model that skips the English half still produced a usable zh answer;
    // losing it would be a worse outcome than a zh-only column.
    const columns = buildFaqColumnsFromEnrichment([
      item('products', '主要產品有哪些？', '皮件。'),
    ])

    expect(columns.faq_products).toEqual({
      question_zh: '主要產品有哪些？',
      answer_zh: '皮件。',
      question_en: null,
      answer_en: null,
    })
  })

  it('ignores an unknown category rather than throwing', () => {
    const columns = buildFaqColumnsFromEnrichment([
      item('shipping_policy', '運費多少？', '滿千免運。'),
      ...PRODUCTS_PAIR,
    ])

    expect(Object.keys(columns)).toEqual(['faq_products'])
  })

  it('fills faq_custom_1..4 in order and drops the fifth pair', () => {
    const customs = [1, 2, 3, 4, 5].flatMap((index) => [
      item('custom', `自訂問題 ${index}？`, `自訂回答 ${index}。`),
      item('custom', `Custom question ${index}?`, `Custom answer ${index}.`),
    ])

    const columns = buildFaqColumnsFromEnrichment(customs)

    expect(columns.faq_custom_1?.question_zh).toBe('自訂問題 1？')
    expect(columns.faq_custom_2?.question_en).toBe('Custom question 2?')
    expect(columns.faq_custom_3?.answer_zh).toBe('自訂回答 3。')
    expect(columns.faq_custom_4?.answer_en).toBe('Custom answer 4.')
    expect(Object.keys(columns)).toHaveLength(4)
  })
})

describe('upsertBrandFaqFromEnrichment', () => {
  const brandId = '8f3d0f2e-6c1a-4f6b-9a0e-2b7c5d1e4a99'

  it('inserts every column when no row exists yet', async () => {
    const { client, upserts } = createClientDouble(null)

    await upsertBrandFaqFromEnrichment(
      brandId,
      [...PRODUCTS_PAIR, ...PRICE_PAIR],
      client,
    )

    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.table).toBe('brand_faq')
    expect(upserts[0]?.options).toEqual({ onConflict: 'brand_id' })
    expect(upserts[0]?.payload).toMatchObject({ brand_id: brandId })
    expect(Object.keys(upserts[0]?.payload ?? {}).sort()).toEqual([
      'brand_id',
      'faq_price',
      'faq_products',
    ])
  })

  it('leaves a populated column untouched and fills only the empty one', async () => {
    const { client, upserts } = createClientDouble({
      brand_id: brandId,
      faq_products: {
        question_zh: '人工編輯過的問題？',
        answer_zh: '人工編輯過的回答。',
        question_en: 'Hand-edited question?',
        answer_en: 'Hand-edited answer.',
      },
      faq_price: null,
    })

    await upsertBrandFaqFromEnrichment(
      brandId,
      [...PRODUCTS_PAIR, ...PRICE_PAIR],
      client,
    )

    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.payload).not.toHaveProperty('faq_products')
    expect(upserts[0]?.payload.faq_price).toMatchObject({
      question_en: 'What is the price range?',
    })
  })

  it('treats a zh-only existing column as populated', async () => {
    const { client, upserts } = createClientDouble({
      brand_id: brandId,
      faq_products: {
        question_zh: '人工編輯過的問題？',
        answer_zh: '人工編輯過的回答。',
        question_en: null,
        answer_en: null,
      },
    })

    await upsertBrandFaqFromEnrichment(brandId, PRODUCTS_PAIR, client)

    expect(upserts).toHaveLength(0)
  })

  it('writes nothing at all for an empty faq payload', async () => {
    const { client, upserts, reads } = createClientDouble(null)

    await upsertBrandFaqFromEnrichment(brandId, [], client)

    expect(reads).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })

  it('writes nothing when the payload only holds unknown categories', async () => {
    const { client, upserts, reads } = createClientDouble(null)

    await upsertBrandFaqFromEnrichment(
      brandId,
      [item('shipping_policy', '運費多少？', '滿千免運。')],
      client,
    )

    expect(reads).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })
})
