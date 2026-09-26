import { describe, expect, it } from 'vitest'
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
} from '@/lib/taxonomy/ontology'
import type { JevAnswer, JevQuestion, JevState } from '@/lib/services/typesafe-client'
import { JEV_CANDIDATES, type DecideFn } from '../jev-questions'

// Fixtures mirror the stored golden inputs recorded in jev-questions.ts's header.
const DETECT_INPUT = {
  user: [
    '品牌 slug：submission-456c87e9',
    '品牌名稱：Design Council Busan',
    '描述：無',
    '網站：https://dcb.or.kr',
    '搜尋摘要：Design Council Busan provides design education；WDO Design Council Busan',
  ].join('\n'),
  promptName: 'detect',
}

const SITE_IDENTITY_INPUT = {
  user: [
    '請裁決以下品牌候選頁面是否真正屬於該品牌：',
    '1. [pangscent] 品牌名稱：雱PĀNG / 宣稱的官方網站 / 網址：https://www.pangscent.com/ / 頁面標題：雱 PĀNG - 台灣靈魂 / 頁面描述：臺灣獨立無性別香氛品牌 / 頁面故事文字：淡香精 A / B 空間噴霧',
  ].join('\n'),
  promptName: 'site-identity',
}

function subsOf(l1: string): string[] {
  return L2_SUBCATEGORIES.filter((s) => s.category === l1).map((s) => s.slug)
}

function fakeDecide(
  answersFor: (questions: Record<string, JevQuestion>) => Record<string, JevAnswer>,
): { decide: DecideFn; calls: Array<{ state: JevState; questions: Record<string, JevQuestion> }> } {
  const calls: Array<{ state: JevState; questions: Record<string, JevQuestion> }> = []
  const decide: DecideFn = async (_profileKey, state, questions) => {
    calls.push({ state, questions })
    return {
      answers: answersFor(questions),
      usage: { input_tokens: 10, output_tokens: 0 },
      latencyMs: 5,
      costUsd: 0.001,
    }
  }
  return { decide, calls }
}

describe('JEV_CANDIDATES', () => {
  it('detect: buildState picks brand fields; toOutput maps noul p>=0.5 to isNonBrand and band via bandFromProbability', () => {
    const c = JEV_CANDIDATES.detect
    const state = c.buildState(DETECT_INPUT)
    expect(state).toEqual({
      name: 'Design Council Busan',
      description: null,
      website: 'https://dcb.or.kr',
      searchSnippets: 'Design Council Busan provides design education；WDO Design Council Busan',
    })
    const q = c.questions(state)
    expect(q.isNonBrand?.type).toBe('noul')

    expect(c.toOutput({ isNonBrand: { noul: 0.95 } }, state)).toEqual({
      isNonBrand: true,
      confidence: 'high',
      probability: 0.95,
    })
    // p = 0.2 → not a non-brand, and the decision's own confidence is 0.8 → medium
    const low = c.toOutput({ isNonBrand: { noul: 0.2 } }, state)
    expect(low.isNonBrand).toBe(false)
    expect(low.probability).toBeCloseTo(0.8)
    expect(low.confidence).toBe('medium')
    // exactly 0.5 counts as a non-brand verdict at low confidence
    expect(c.toOutput({ isNonBrand: { noul: 0.5 } }, state)).toEqual({
      isNonBrand: true,
      confidence: 'low',
      probability: 0.5,
    })
  })

  it('classification: options are exactly the 12 L1 slugs with descriptions from L1_CATEGORIES', () => {
    const c = JEV_CANDIDATES.classification
    const state = c.buildState({ user: '品牌名稱：尾八\n描述：手繪招牌與插畫紙品', promptName: 'category-classify' })
    expect(state).toEqual({ name: '尾八', description: '手繪招牌與插畫紙品' })
    const q = c.questions(state).category
    expect(q?.type).toBe('choice')
    const criteria = (q as { criteria: Record<string, string> }).criteria
    expect(Object.keys(criteria)).toEqual(L1_CATEGORIES.map((cat) => cat.slug))
    for (const cat of L1_CATEGORIES) {
      const desc = criteria[cat.slug]!
      expect(desc.trim().length).toBeGreaterThan(0)
      expect(desc).not.toBe(cat.name)
      expect(desc).not.toBe(cat.nameZh)
      expect(desc).not.toBe(cat.slug)
    }
    const home = L1_CATEGORIES[4].slug
    const out = c.toOutput(
      { category: { choice: home, probabilities: { [home]: 0.92, [L1_CATEGORIES[6].slug]: 0.08 } } },
      state,
    )
    expect(out).toEqual({ category: home, confidence: 'high', probability: 0.92 })
  })

  it('siteIdentity: toOutput maps owned noul to {owned, confidence, probability}', () => {
    const c = JEV_CANDIDATES.siteIdentity
    const state = c.buildState(SITE_IDENTITY_INPUT)
    expect(state).toMatchObject({
      brandName: '雱PĀNG',
      subjectKind: 'website',
      url: 'https://www.pangscent.com/',
      title: '雱 PĀNG - 台灣靈魂',
      description: '臺灣獨立無性別香氛品牌',
      // a " / " inside a value is not a field boundary
      story: '淡香精 A / B 空間噴霧',
    })
    expect(c.questions(state).owned?.type).toBe('noul')
    expect(c.toOutput({ owned: { noul: 0.75 } }, state)).toEqual({
      owned: true,
      confidence: 'medium',
      probability: 0.75,
    })
    const notOwned = c.toOutput({ owned: { noul: 0.02 } }, state)
    expect(notOwned.owned).toBe(false)
    expect(notOwned.confidence).toBe('high')
    expect(notOwned.probability).toBeCloseTo(0.98)
  })

  it('productCategory: beam K=3 builds 1 L1 choice + 3 L2 choices, and toOutput picks the max joint probability with an L2 that belongs to its L1', async () => {
    const [a, b, c3, d] = [L1_CATEGORIES[4].slug, L1_CATEGORIES[3].slug, L1_CATEGORIES[6].slug, L1_CATEGORIES[0].slug]
    const cand = JEV_CANDIDATES.productCategory
    const input = '產品名稱：手作陶瓷香氛蠟燭\n描述：大豆蠟與陶瓷杯'
    const state = cand.buildState(input)
    expect(state).toEqual({ name: '手作陶瓷香氛蠟燭', description: '大豆蠟與陶瓷杯' })

    const l1Probs = { [a]: 0.5, [b]: 0.3, [c3]: 0.15, [d]: 0.05 }
    const { decide, calls } = fakeDecide((questions) => {
      if (questions.l1) return { l1: { choice: a, probabilities: l1Probs } }
      const answers: Record<string, JevAnswer> = {}
      for (const [key, question] of Object.entries(questions)) {
        const keys = Object.keys((question as { criteria: Record<string, string> }).criteria)
        // top L1 gets a weak L2 (0.5 * 0.4 = 0.2); second L1 a strong one (0.3 * 0.9 = 0.27)
        const p = key === cand.l2Key(a) ? 0.4 : key === cand.l2Key(b) ? 0.9 : 0.99
        answers[key] = { choice: keys[0], probabilities: { [keys[0]!]: p } }
      }
      return answers
    })

    const result = await cand.run(decide, input)
    expect(calls).toHaveLength(2)
    expect(Object.keys(calls[0]!.questions)).toEqual(['l1'])
    const l1Criteria = (calls[0]!.questions.l1 as { criteria: Record<string, string> }).criteria
    expect(Object.keys(l1Criteria)).toEqual(L1_CATEGORIES.map((cat) => cat.slug))
    // step 2: exactly the top-3 L1s, each over its own L2 set
    expect(Object.keys(calls[1]!.questions)).toEqual([cand.l2Key(a), cand.l2Key(b), cand.l2Key(c3)])
    for (const l1 of [a, b, c3]) {
      const q = calls[1]!.questions[cand.l2Key(l1)] as { type: string; criteria: Record<string, string> }
      expect(q.type).toBe('choice')
      expect(Object.keys(q.criteria)).toEqual(subsOf(l1))
      for (const desc of Object.values(q.criteria)) expect(desc.trim().length).toBeGreaterThan(0)
    }
    // c3's L2 has the highest conditional (0.99) but joint 0.15 * 0.99 < 0.27
    expect(result.output).toEqual({
      category: b,
      subcategory: subsOf(b)[0],
      confidence: 'low',
      probability: expect.closeTo(0.27, 6),
    })
    expect(result.costUsd).toBeCloseTo(0.002)
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 0 })

    // An L2 that does not belong to its L1 is never picked.
    const foreign = subsOf(d)[0]!
    const out = cand.toOutput(
      {
        l1: { choice: a, probabilities: { [a]: 0.6, [b]: 0.4 } },
        [cand.l2Key(a)]: { choice: foreign, probabilities: { [foreign]: 0.99 } },
        [cand.l2Key(b)]: { choice: subsOf(b)[1], probabilities: { [subsOf(b)[1]!]: 0.5 } },
      },
      state,
    )
    expect(out.category).toBe(b)
    expect(out.subcategory).toBe(subsOf(b)[1])
    expect(out.probability).toBeCloseTo(0.2)
  })

  it('intentParse: 12 material nouls keyed by MATERIALS slugs; toOutput coarsens subcategory to null when L2 confidence < 0.9; materials include p>=0.5 only', async () => {
    const cand = JEV_CANDIDATES.intentParse
    const state = cand.buildState({ query: '送給喜歡泡茶的朋友' })
    expect(state).toEqual({ query: '送給喜歡泡茶的朋友' })
    const q = cand.questions(state)
    const materialKeys = MATERIALS.map((m) => m.slug)
    expect(materialKeys).toHaveLength(12)
    for (const slug of materialKeys) {
      expect(q[slug]?.type).toBe('noul')
      expect((q[slug] as { instructions: string }).instructions.length).toBeGreaterThan(0)
    }
    expect(Object.keys(q).sort()).toEqual(['category', ...materialKeys].sort())

    const home = L1_CATEGORIES[4].slug
    const homeSub = subsOf(home)[0]!
    const [m0, m1, m2] = [MATERIALS[0].slug, MATERIALS[1].slug, MATERIALS[2].slug]
    const stepOne: Record<string, JevAnswer> = {
      category: { choice: home, probabilities: { [home]: 0.8 } },
      [m0]: { noul: 0.7 },
      [m1]: { noul: 0.5 },
      [m2]: { noul: 0.49 },
    }
    const coarse = cand.toOutput(
      { ...stepOne, subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.89 } } },
      state,
    )
    expect(coarse).toEqual({ category: home, subcategory: null, materials: [m0, m1], probability: 0.8 })

    const fine = cand.toOutput(
      { ...stepOne, subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.9 } } },
      state,
    )
    expect(fine.subcategory).toBe(homeSub)

    // run(): step 2 asks one L2 choice over the chosen L1's subcategories
    const { decide, calls } = fakeDecide((questions) =>
      questions.subcategory
        ? { subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.95 } } }
        : stepOne,
    )
    const result = await cand.run(decide, { query: '送給喜歡泡茶的朋友' })
    expect(calls).toHaveLength(2)
    const sub = calls[1]!.questions.subcategory as { type: string; criteria: Record<string, string> }
    expect(sub.type).toBe('choice')
    expect(Object.keys(sub.criteria)).toEqual(subsOf(home))
    expect(result.output).toEqual({ category: home, subcategory: homeSub, materials: [m0, m1], probability: 0.8 })
  })

  it('relevanceJudge: 4-level score (zero-indexed 0..3) with described levels; toOutput returns an integer grade = round(score), probabilities from the answer, votes = [grade]', () => {
    const cand = JEV_CANDIDATES.relevanceJudge
    const state = cand.buildState({
      query: '送給剛搬新家的朋友',
      product: {
        name_zh: '手作陶瓷香氛蠟燭',
        name_en: null,
        category_zh: '居家生活',
        description_zh: 'x'.repeat(800),
      },
    })
    expect(state).toEqual({
      query: '送給剛搬新家的朋友',
      product: { name_zh: '手作陶瓷香氛蠟燭', category_zh: '居家生活', description_zh: 'x'.repeat(600) },
    })
    const q = cand.questions(state).grade as { type: string; criteria: Record<string, string> }
    expect(q.type).toBe('score')
    expect(Object.keys(q.criteria)).toEqual(['0', '1', '2', '3'])
    expect(q.criteria['0']).toMatch(/Irrelevant/)
    expect(q.criteria['3']).toMatch(/Exact match/)
    for (const desc of Object.values(q.criteria)) expect(desc.length).toBeGreaterThan(10)

    const probabilities = { '0': 0.05, '1': 0.15, '2': 0.5, '3': 0.3 }
    expect(cand.toOutput({ grade: { score: 2.05, probabilities } }, state)).toEqual({
      grade: 2,
      votes: [2],
      unanimous: true,
      split: false,
      probabilities,
    })
    expect(cand.toOutput({ grade: { score: 2.6 } }, state).votes).toEqual([3])
    // no score → no vote, like an all-malformed OpenAI judge run
    expect(cand.toOutput({}, state)).toEqual({ grade: null, votes: [], unanimous: false, split: false })
  })
})
