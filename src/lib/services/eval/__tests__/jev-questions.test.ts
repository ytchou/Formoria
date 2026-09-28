import { describe, expect, it } from 'vitest'
import {
  L1_CATEGORIES,
  L2_SUBCATEGORIES,
  MATERIALS,
} from '@/lib/taxonomy/ontology'
import { RELEVANCE_GRADE_LEVELS } from '@/lib/prompts/shared'
import type { JevAnswer, JevQuestion, JevState } from '@/lib/services/typesafe-client'
import { snapshotPrompt } from '@/lib/langfuse/prompt'
import { renderDetectUserMessage } from '@/lib/services/category-classifier'
import { JEV_CANDIDATES, argmaxGrade, detectRuleSections, type DecideFn } from '../jev-questions'

// Fixtures mirror the stored golden inputs recorded in jev-questions.ts's header.
const DETECT_RULES = [
  'Intro line.',
  '',
  '## Not a product brand',
  'Non-brand types and boundaries.',
  '',
  '## Confidence',
  'Band rules.',
].join('\n')

const DETECT_USER = renderDetectUserMessage({
  slug: 'submission-456c87e9',
  name: 'Design Council Busan',
  description: null,
  website: 'https://dcb.or.kr',
  submittedWebsite: 'https://dcb.or.kr/about',
  results: [
    { title: 'Design Council Busan', snippet: 'provides design education', host: 'dcb.or.kr', match: 'site' },
    { title: 'WDO Design Council Busan', host: 'wdo.org', match: null },
  ],
  probes: [
    { url: 'https://dcb.or.kr', title: 'DCB', description: 'Design Council Busan' },
    { url: 'https://dead.example.com', status: 404 },
  ],
})

const DETECT_INPUT = { user: DETECT_USER, promptName: 'detect', rules: DETECT_RULES }

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
      usage: { inputTokens: 10, outputTokens: 0 },
      latencyMs: 5,
      costUsd: 0.001,
    }
  }
  return { decide, calls }
}

describe('JEV_CANDIDATES', () => {
  it('every noul criteria is absent or a { true, false } object with non-empty strings', () => {
    let nouls = 0
    for (const cand of Object.values(JEV_CANDIDATES)) {
      // names builds its one choice from the parsed state and asks no noul.
      if (cand === JEV_CANDIDATES.names) continue
      const state = cand === JEV_CANDIDATES.detect ? JEV_CANDIDATES.detect.buildState(DETECT_INPUT) : undefined
      const questions = (cand.questions as (state: unknown) => Record<string, JevQuestion>)(state)
      for (const q of Object.values(questions)) {
        if (q.type !== 'noul') continue
        nouls++
        if (q.criteria === undefined) continue
        expect(typeof q.criteria).toBe('object')
        expect(Object.keys(q.criteria).sort()).toEqual(['false', 'true'])
        expect(q.criteria.true.trim().length).toBeGreaterThan(0)
        expect(q.criteria.false.trim().length).toBeGreaterThan(0)
      }
    }
    // detect's three + one per material
    expect(nouls).toBe(3 + MATERIALS.length)
  })

  it('rule_sections_keep_and_drop: slices the real detect prompt by heading', () => {
    const text = snapshotPrompt('detect').text
    const body = (heading: string): string => {
      const at = text.indexOf(`${heading}\n`)
      const next = text.indexOf('\n## ', at + heading.length)
      return text.slice(at + heading.length, next === -1 ? undefined : next).trim()
    }
    const intro = text.slice(0, text.indexOf('\n## ')).trim()
    const rules = detectRuleSections(text)

    expect(rules.startsWith(intro)).toBe(true)
    for (const kept of ['## Not a product brand', '## Input', '## Golden anchors']) {
      expect(rules).toContain(kept)
      expect(rules).toContain(body(kept))
    }
    for (const dropped of ['## Confidence', '## Slug', '## Brand name']) {
      expect(rules).not.toContain(dropped)
      expect(rules).not.toContain(body(dropped))
    }
  })

  it('rule_sections_throw_on_missing_heading', () => {
    expect(() => detectRuleSections('Intro.\n\n## Input\nFields.')).toThrow(/Not a product brand/)
  })

  it('build_state_parses_new_labels: results, submitted website and probes from a rendered message', () => {
    const state = JEV_CANDIDATES.detect.buildState(DETECT_INPUT)
    const lines = DETECT_USER.split('\n')
    const valuesOf = (label: string) =>
      lines.filter((l) => l.startsWith(`${label}：`)).map((l) => l.slice(label.length + 1))

    expect(state.name).toBe('Design Council Busan')
    expect(state.description).toBeNull()
    expect(state.website).toBe('https://dcb.or.kr')
    expect(state.submittedWebsite).toBe('https://dcb.or.kr/about')
    expect(valuesOf('搜尋結果')).toHaveLength(2)
    expect(state.searchResults).toBe(valuesOf('搜尋結果').join('\n'))
    expect(valuesOf('探測')).toHaveLength(2)
    expect(state.probes).toBe(valuesOf('探測').join('\n'))
    expect(state.rules).toBe(detectRuleSections(DETECT_RULES))
  })

  it('build_state_parses_new_labels: absent results, submitted website and probes are null', () => {
    const state = JEV_CANDIDATES.detect.buildState({
      user: renderDetectUserMessage({ slug: 's', name: '山焙茶室', description: '鹿谷炭焙烏龍', website: null }),
      rules: DETECT_RULES,
    })
    expect(state).toMatchObject({
      name: '山焙茶室',
      description: '鹿谷炭焙烏龍',
      website: null,
      submittedWebsite: null,
      searchResults: null,
      probes: null,
    })
  })

  it('build_state_maps_old_snippet_label: a pre-DEV-1894 message keeps website clean', () => {
    // The pre-DEV-1894 renderer: one 搜尋摘要 line of ；-joined snippets, no 搜尋結果.
    const oldUser = [
      '品牌 slug：submission-456c87e9',
      '品牌名稱：Design Council Busan',
      '描述：無',
      '網站：https://dcb.or.kr',
      '搜尋摘要：Busan designated World Design Capital；SUMIDA MODERN',
      '探測：DCB — Design Council Busan',
    ].join('\n')
    const state = JEV_CANDIDATES.detect.buildState({ user: oldUser, promptName: 'detect', rules: DETECT_RULES })
    expect(state.website).toBe('https://dcb.or.kr')
    expect(state.searchResults).toBe('Busan designated World Design Capital；SUMIDA MODERN')
    expect(state.probes).toBe('DCB — Design Council Busan')
  })

  it('missing_rules_throws: the candidate never runs on hand-written rules', () => {
    expect(() => JEV_CANDIDATES.detect.buildState({ user: DETECT_USER, promptName: 'detect' })).toThrow(/rules/)
    expect(() => JEV_CANDIDATES.detect.buildState(DETECT_USER)).toThrow(/rules/)
  })

  it('questions_share_rules_verbatim: three questions, same rules prefix, distinct stems', () => {
    const c = JEV_CANDIDATES.detect
    expect(c.profileKey).toBe('detect')
    const state = c.buildState(DETECT_INPUT)
    const q = c.questions(state)
    expect(Object.keys(q).sort()).toEqual(['aboutEntity', 'nonBrandType', 'ownProductLine'])
    const stems = Object.values(q).map((question) => {
      expect(question.type).toBe('noul')
      expect(question.instructions.startsWith(state.rules)).toBe(true)
      return question.instructions.slice(state.rules.length).trim()
    })
    expect(new Set(stems).size).toBe(3)
    expect(stems.every((stem) => stem.length > 0)).toBe(true)
  })

  it('product_score_output: P(non-brand) = about * type * (1 - own); probability is P(chosen verdict)', () => {
    const c = JEV_CANDIDATES.detect
    const out = c.toOutput({ aboutEntity: { noul: 0.9 }, nonBrandType: { noul: 0.8 }, ownProductLine: { noul: 0.25 } })
    expect(out.isNonBrand).toBe(true)
    expect(out.probability).toBeCloseTo(0.54)
    expect(out.confidence).toBe('low')

    const brand = c.toOutput({ aboutEntity: { noul: 0.9 }, nonBrandType: { noul: 0.2 }, ownProductLine: { noul: 0.9 } })
    expect(brand.isNonBrand).toBe(false)
    expect(brand.probability).toBeCloseTo(1 - 0.9 * 0.2 * 0.1)
    expect(brand.confidence).toBe('high')

    expect(() => c.toOutput({ aboutEntity: { noul: 0.9 }, nonBrandType: { noul: 0.8 } })).toThrow(/ownProductLine/)
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
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 0 })

    // An L2 that does not belong to its L1 is never picked.
    const foreign = subsOf(d)[0]!
    const out = cand.toOutput(
      {
        l1: { choice: a, probabilities: { [a]: 0.6, [b]: 0.4 } },
        [cand.l2Key(a)]: { choice: foreign, probabilities: { [foreign]: 0.99 } },
        [cand.l2Key(b)]: { choice: subsOf(b)[1], probabilities: { [subsOf(b)[1]!]: 0.5 } },
      },
    )
    expect(out.category).toBe(b)
    expect(out.subcategory).toBe(subsOf(b)[1])
    expect(out.probability).toBeCloseTo(0.2)
  })

  it('productCategory and intentParse describe each L1 by its own subcategory names (DEV-1887)', async () => {
    const product = JEV_CANDIDATES.productCategory
    const intent = JEV_CANDIDATES.intentParse
    const l1Questions = [
      product.questions(product.buildState('產品名稱：茶杯\n描述：陶瓷')).l1,
      intent.questions(intent.buildState({ query: '茶杯' })).category,
    ]
    for (const q of l1Questions) {
      const criteria = (q as { criteria: Record<string, string> }).criteria
      expect(Object.keys(criteria)).toEqual(L1_CATEGORIES.map((cat) => cat.slug))
      for (const cat of L1_CATEGORIES) {
        const members = L2_SUBCATEGORIES.filter((s) => s.category === cat.slug).map((s) => s.nameZh)
        expect(criteria[cat.slug]).toBe(`${cat.nameZh}（${cat.name}）：${members.join('、')}`)
      }
    }
  })

  it('intentParse: 12 material nouls keyed by MATERIALS slugs; toOutput coarsens subcategory to null when L2 confidence < 0.9; materials include p>=0.85 only (DEV-1889)', async () => {
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
      [m0]: { noul: 0.9 },
      [m1]: { noul: 0.85 },
      [m2]: { noul: 0.84 },
    }
    const coarse = cand.toOutput(
      { ...stepOne, subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.89 } } },
    )
    expect(coarse).toEqual({ category: home, subcategory: null, materials: [m0, m1], probability: 0.8 })

    const fine = cand.toOutput(
      { ...stepOne, subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.9 } } },
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

  it('intentParse: P(L1) < 0.6 returns a null category and skips the step-2 call; 0.6 keeps it (DEV-1889)', async () => {
    const cand = JEV_CANDIDATES.intentParse
    const home = L1_CATEGORIES[4].slug
    const homeSub = subsOf(home)[0]!
    const vague = { category: { choice: home, probabilities: { [home]: 0.59 } } }
    expect(cand.toOutput({ ...vague, subcategory: { choice: homeSub, probabilities: { [homeSub]: 0.99 } } })).toEqual({
      category: null,
      subcategory: null,
      materials: [],
      probability: 0.59,
    })

    const low = fakeDecide(() => vague)
    const lowResult = await cand.run(low.decide, { query: 'q' })
    expect(low.calls).toHaveLength(1)
    expect(lowResult.output.category).toBeNull()

    const atMin = fakeDecide((questions): Record<string, JevAnswer> =>
      questions.subcategory ? {} : { category: { choice: home, probabilities: { [home]: 0.6 } } },
    )
    const minResult = await cand.run(atMin.decide, { query: 'q' })
    expect(atMin.calls).toHaveLength(2)
    expect(minResult.output).toMatchObject({ category: home, subcategory: null, probability: 0.6 })
  })

  it('names: one choice over the distinct candidate names, stored first; evidence and snippets parsed; toOutput returns the chosen name (DEV-1888)', () => {
    const cand = JEV_CANDIDATES.names
    const input = {
      user: [
        '請裁決以下品牌的正式名稱：',
        '1. [lid] 儲存名稱：LID Shoes / 候選：stored：LID Shoes；cleaned：LID Shoes；official_website：劉一刀手工鞋 LID Shoes（official_website https://www.lidshoes.com observed="劉一刀 手工鞋"） / 搜尋摘要：LID Shoes 手工鞋；A / B 評測',
      ].join('\n'),
      promptName: 'name-arbiter',
    }
    const state = cand.buildState(input)
    expect(state.storedName).toBe('LID Shoes')
    expect(state.searchSnippets).toBe('LID Shoes 手工鞋；A / B 評測')
    const q = cand.questions(state).name as { type: string; criteria: Record<string, string> }
    expect(q.type).toBe('choice')
    expect(Object.keys(q.criteria)).toEqual(['LID Shoes', '劉一刀手工鞋 LID Shoes'])
    expect(q.criteria['LID Shoes']).toContain('stored, cleaned')
    expect(q.criteria['劉一刀手工鞋 LID Shoes']).toContain('https://www.lidshoes.com')

    const out = cand.toOutput({
      name: { choice: '劉一刀手工鞋 LID Shoes', probabilities: { '劉一刀手工鞋 LID Shoes': 0.93, 'LID Shoes': 0.07 } },
    })
    expect(out).toEqual({ chosen: '劉一刀手工鞋 LID Shoes', confidence: 'high', probability: 0.93 })
    expect(() => cand.buildState({ user: 'no item line' })).toThrow()
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
    const q = cand.questions(state).grade as { type: string; criteria: unknown }
    expect(q.type).toBe('score')
    // The API takes score criteria as an array; a level's number is its index.
    expect(Array.isArray(q.criteria)).toBe(true)
    const levels = q.criteria as string[]
    expect(levels).toHaveLength(4)
    RELEVANCE_GRADE_LEVELS.forEach((level, grade) => expect(levels[grade]).toBe(level))
    expect(levels[0]).toMatch(/Irrelevant/)
    expect(levels[3]).toMatch(/Exact match/)
    for (const desc of levels) expect(desc.length).toBeGreaterThan(10)

    const probabilities = { '0': 0.05, '1': 0.15, '2': 0.5, '3': 0.3 }
    expect(cand.toOutput({ grade: { score: 2.05, probabilities } })).toEqual({
      grade: 2,
      votes: [2],
      unanimous: true,
      split: false,
      probabilities,
    })
    expect(cand.toOutput({ grade: { score: 2.6 } }).votes).toEqual([3])
    // no score → no vote, like an all-malformed OpenAI judge run
    expect(cand.toOutput({})).toEqual({ grade: null, votes: [], unanimous: false, split: false })
  })
})

describe('argmaxGrade', () => {
  it('returns the most probable level', () => {
    expect(argmaxGrade({ '0': 0.1, '1': 0.2, '2': 0.6, '3': 0.1 })).toBe(2)
  })

  it('breaks a tie toward the lower (stricter) level', () => {
    expect(argmaxGrade({ '0': 0.45, '1': 0.45, '2': 0.1, '3': 0 })).toBe(0)
  })

  it('returns null without probabilities or with non-level keys only', () => {
    expect(argmaxGrade(undefined)).toBeNull()
    expect(argmaxGrade({ high: 1 })).toBeNull()
  })
})
