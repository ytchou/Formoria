import { describe, expect, it, vi } from 'vitest'
import { adapterFor } from '../phase-adapters'
import { toStrictJsonSchema } from '../../_shared/zod-schema'
import { isHighConfidenceWrite } from '../../enrich-phases/detect'
import { INTENT_PARSE_JSON_SCHEMA, INTENT_PARSE_SYSTEM_PROMPT } from '../../query-intent-parse'
import type { DecideFn, JevAnswers } from '../jev-questions'
import type { ExperimentArm, ExperimentItem } from '../run-experiment'
import { CritiqueVerdictSchema } from '../../enrich-phases/acquisition/plan'
import { PRODUCTS_PROMPT_VARIABLES, PRODUCTS_PROPOSAL_SHAPE, PRODUCTS_SCHEMA } from '../../enrich-phases/products'
import { REPAIR_SCHEMA } from '../../enrich-phases/products/graph'

const GOLDEN_DATASET_NAMES = [
  'detect-confidence-golden',
  'category-confidence-golden',
  'name-arbiter-confidence-golden',
  'site-identity-confidence-golden',
  'products-agent-ranking-golden',
  'intent-parse-golden',
] as const

/** Golden datasets with no Langfuse prompt: their task builds the request itself. */
const PROMPTLESS_DATASETS: ReadonlySet<string> = new Set(['intent-parse-golden'])

describe('phase-adapters registry', () => {
  it('resolves each of the six golden dataset names plus descriptions', () => {
    for (const name of GOLDEN_DATASET_NAMES) {
      const adapter = adapterFor(name)
      expect(adapter).toBeDefined()
      if (PROMPTLESS_DATASETS.has(name)) {
        expect(adapter.promptName).toBeNull()
      } else {
        expect(adapter.promptName).toEqual(expect.any(String))
      }
      expect(adapter.profileKey).toEqual(expect.any(String))
      expect(adapter.outputSchema).toBeDefined()
      expect(adapter.requestSchema).toEqual({
        name: expect.any(String),
        schema: expect.any(Object),
      })
      expect(adapter.unwrap).toEqual(expect.any(Function))
      expect(adapter.expectedOf).toEqual(expect.any(Function))
      expect(adapter.expectedSchema).toBeDefined()
      expect(typeof adapter.mode).toBe('string')
    }

    // descriptions adapter
    const desc = adapterFor('descriptions')
    expect(desc).toBeDefined()
    expect(desc.promptName).toEqual(expect.any(String))
    expect(desc.mode).toBe('pairwise')
  })

  it('products adapter is scored with four scorers and a task', () => {
    const adapter = adapterFor('products-agent-ranking-golden')
    expect(adapter.mode).toBe('scored')

    const scorerNames = adapter.scorers.map((s) => s.name)
    expect(scorerNames).toContain('bandAgreement')
    expect(scorerNames).toContain('withinPoolOrderingAgreement')
    expect(scorerNames).toContain('selectionAgreement')
    expect(scorerNames).toContain('originWhenSourced')
    expect(scorerNames).toHaveLength(4)

    // only originWhenSourced can be n/a, so failures must not zero it
    const nullable = adapter.scorers.filter((s) => s.nullable).map((s) => s.name)
    expect(nullable).toEqual(['originWhenSourced'])

    expect(typeof adapter.task).toBe('function')
    expect(typeof adapter.summarize).toBe('function')
  })

  it('requestSchema is the strict JSON-schema wrapper the OpenAI client expects', () => {
    for (const name of GOLDEN_DATASET_NAMES) {
      const adapter = adapterFor(name)
      const { requestSchema } = adapter
      expect(requestSchema).toHaveProperty('name')
      expect(typeof requestSchema.name).toBe('string')
      expect(requestSchema).toHaveProperty('schema')
      expect(typeof requestSchema.schema).toBe('object')

      // Must match toStrictJsonSchema output for the outputSchema
      const expectedSchema = toStrictJsonSchema(adapter.outputSchema)
      expect(requestSchema.schema).toEqual(expectedSchema)
    }
  })

  it('parseOutput turns a content string into a validated object', () => {
    const adapter = adapterFor('detect-confidence-golden')
    const valid = JSON.stringify({
      results: [{
        reasoning: 'test',
        isNonBrand: false,
        nonBrandReason: null,
        brand_name: 'Test',
        slug_generated: 'test',
        confidence: 'high',
        slug: 'test',
      }],
    })
    const result = adapter.parseOutput(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBeDefined()
    }

    // malformed content
    const malformed = adapter.parseOutput('not json')
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) {
      expect(malformed.error).toBeDefined()
    }

    // valid JSON but wrong shape
    const wrongShape = adapter.parseOutput(JSON.stringify({ wrong: true }))
    expect(wrongShape.ok).toBe(false)
  })

  it('category adapter unwraps {results:[…]} to the first result and scores against expected', () => {
    const adapter = adapterFor('category-confidence-golden')
    const batchOutput = {
      results: [
        { slug: 'test', reasoning: 'test', category: 'beauty', confidence: 'high' },
      ],
    }
    const unwrapped = adapter.unwrap(batchOutput)
    expect(unwrapped).toEqual(batchOutput.results[0])

    // scorers include the right names
    const scorerNames = adapter.scorers.map((s) => s.name)
    expect(scorerNames).toContain('categoryAgreement')
    expect(scorerNames).toContain('confidenceBandAgreement')
    expect(scorerNames).toContain('writeEligibleAgreement')
  })

  it('detect adapter maps isNonBrand/confidence/slugGenerated/brandName', () => {
    const adapter = adapterFor('detect-confidence-golden')
    const item = {
      expectedOutput: {
        isNonBrand: true,
        confidence: 'high',
        slugGenerated: 'test-slug',
        brandName: 'Test Brand',
      },
    }
    const expected = adapter.expectedOf(item)
    expect(expected).toEqual({
      isNonBrand: true,
      confidence: 'high',
      slugGenerated: 'test-slug',
      brandName: 'Test Brand',
    })
  })

  it('name-arbiter decisionAgreement accepts any of the golden acceptedNames', () => {
    const adapter = adapterFor('name-arbiter-confidence-golden')
    // Shape of the Langfuse items (2026-09-26)
    const item = { expectedOutput: { confidence: 'high', acceptedNames: ['ADELA', 'Adela 愛德拉'] } }
    expect(adapter.expectedSchema.safeParse(item.expectedOutput).success).toBe(true)

    const expected = adapter.expectedOf(item)
    const decision = adapter.scorers.find((s) => s.name === 'decisionAgreement')!
    const verdict = (chosen: string) => ({ slug: 'adela', chosen, confidence: 'high', reason: '' })
    expect(decision.fn(verdict('Adela 愛德拉'), expected)).toBe(1)
    expect(decision.fn(verdict('ADELA'), expected)).toBe(1)
    expect(decision.fn(verdict('德瑪貝爾化粧品'), expected)).toBe(0)
  })

  it('name-arbiter and site-identity adapters expose their exported shapes', () => {
    const nameAdapter = adapterFor('name-arbiter-confidence-golden')
    expect(nameAdapter.outputSchema).toBeDefined()
    // The requestSchema should match what the module exports
    expect(nameAdapter.requestSchema.schema).toEqual(
      toStrictJsonSchema(nameAdapter.outputSchema),
    )

    const siteAdapter = adapterFor('site-identity-confidence-golden')
    expect(siteAdapter.outputSchema).toBeDefined()
    expect(siteAdapter.requestSchema.schema).toEqual(
      toStrictJsonSchema(siteAdapter.outputSchema),
    )
  })

  it('products_propose_adapter_declares_four_variables', () => {
    const adapter = adapterFor('products-agent-ranking-golden')
    expect(adapter.variables).toBeDefined()
    expect(Object.keys(adapter.variables!).sort()).toEqual(
      ['category_list', 'editorial_bands', 'material_vocab_block', 'subcategory_vocab_block'],
    )
  })

  it('descriptions adapter is pairwise-only', () => {
    const adapter = adapterFor('descriptions')
    expect(adapter.mode).toBe('pairwise')

    // guardrail scorers only
    const scorerNames = adapter.scorers.map((s) => s.name)
    expect(scorerNames).toContain('bannedTermScore')
    expect(scorerNames).toContain('schemaCompliance')
    // no decision-level scorers
    expect(scorerNames).not.toContain('categoryAgreement')
    expect(scorerNames).not.toContain('decisionAgreement')
  })

  it('adapters_have_no_fallbackPrompt', () => {
    const allNames = [
      ...GOLDEN_DATASET_NAMES,
      'descriptions',
    ]
    for (const name of allNames) {
      const adapter = adapterFor(name)
      expect(adapter).not.toHaveProperty('fallbackPrompt')
    }
  })
})

describe('isHighConfidenceWrite', () => {
  it('is true only for confidence high', () => {
    expect(isHighConfidenceWrite({ confidence: 'high' })).toBe(true)
    expect(isHighConfidenceWrite({ confidence: 'medium' })).toBe(false)
    expect(isHighConfidenceWrite({ confidence: 'low' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DEV-1824: Jev decide wiring and the intent-parse golden dataset
// ---------------------------------------------------------------------------

function goldenItem(input: unknown, expectedOutput: unknown): ExperimentItem {
  return { id: 'item-1', input, expectedOutput, humanApproval: {} }
}

/** A fake `decide` that answers every call with the given answers. */
function fakeDecide(answers: JevAnswers): DecideFn {
  return vi.fn(async () => ({
    answers,
    usage: { inputTokens: 10, outputTokens: 2 },
    latencyMs: 5,
    costUsd: 0.0001,
  }))
}

describe('Jev decide wiring', () => {
  const cases = [
    {
      dataset: 'detect-confidence-golden',
      primary: 'decisionAgreement',
      input: { user: 'brand line', promptName: 'detect' },
      answers: { isNonBrand: { noul: 0.95 } },
      expectedOutput: { isNonBrand: true, confidence: 'high' },
    },
    {
      dataset: 'category-confidence-golden',
      primary: 'categoryAgreement',
      input: { user: 'brand line', promptName: 'category-classify' },
      answers: { category: { choice: 'beauty', probabilities: { beauty: 0.95 } } },
      expectedOutput: { category: 'beauty', confidence: 'high' },
    },
    {
      dataset: 'site-identity-confidence-golden',
      primary: 'decisionAgreement',
      input: { user: 'site line', promptName: 'site-identity' },
      answers: { owned: { noul: 0.05 } },
      expectedOutput: { owned: false, confidence: 'high', writeEligible: false },
    },
  ] as const

  it('detect/category/site-identity adapters expose decide mapping to the scorer output shape', async () => {
    for (const c of cases) {
      const decide = fakeDecide(c.answers)
      const adapter = adapterFor(c.dataset, { decide })
      expect(typeof adapter.decide).toBe('function')

      const item = goldenItem(c.input, c.expectedOutput)
      const result = await adapter.decide!(item, { itemRunId: 'run-1' })
      expect(result.ok).toBe(true)
      expect(decide).toHaveBeenCalledTimes(1)

      const expected = adapter.expectedOf(item)
      const scores = Object.fromEntries(adapter.scorers.map((s) => [s.name, s.fn(result.output, expected)]))
      // The primary agreement scorer applies (not n/a) and agrees on these fixtures.
      expect(scores[c.primary]).toBe(1)
      expect(scores.confidenceBandAgreement).toBe(1)
      expect((result.output as { probability: number }).probability).toBeCloseTo(0.95)
    }
  })

  it('the default registry wires decide on the three confidence adapters', () => {
    for (const c of cases) {
      expect(typeof adapterFor(c.dataset).decide).toBe('function')
    }
  })

  it('decide returns ok:false with the error instead of throwing', async () => {
    const decide: DecideFn = vi.fn(async () => {
      throw new Error('typesafe 503')
    })
    const adapter = adapterFor('detect-confidence-golden', { decide })
    const result = await adapter.decide!(goldenItem({ user: 'x' }, null), { itemRunId: 'run-1' })
    expect(result).toEqual({ ok: false, output: null, error: 'typesafe 503' })
  })
})

describe('intent-parse-golden adapter', () => {
  const arm: ExperimentArm = { name: 'gpt-4o-mini', type: 'model', value: 'gpt-4o-mini' }

  it('intent-parse-golden adapter: promptName null, task sends the live system prompt', async () => {
    const callModel = vi.fn(async () => ({
      ok: true,
      content: JSON.stringify({ category: 'home', subcategory: null, materials: ['wood'] }),
    }))
    const adapter = adapterFor('intent-parse-golden', { callModel })
    expect(adapter.promptName).toBeNull()
    expect(adapter.profileKey).toBe('intentParse')
    expect(adapter.mode).toBe('scored')

    const result = await adapter.task!(goldenItem({ query: 'a query' }, null), arm, {
      itemRunId: 'run-1',
      model: 'gpt-4o-mini',
    })
    expect(result).toMatchObject({
      ok: true,
      output: { category: 'home', subcategory: null, materials: ['wood'] },
    })
    expect(callModel).toHaveBeenCalledWith(
      { system: INTENT_PARSE_SYSTEM_PROMPT, user: 'a query', schema: INTENT_PARSE_JSON_SCHEMA },
      { model: 'gpt-4o-mini' },
    )
  })

  it('task fails the item on a failed call or an off-schema reply', async () => {
    const failed = adapterFor('intent-parse-golden', { callModel: async () => ({ ok: false, content: '' }) })
    expect((await failed.task!(goldenItem({ query: 'q' }, null), arm, { itemRunId: 'r' })).ok).toBe(false)

    const offSchema = adapterFor('intent-parse-golden', {
      callModel: async () => ({ ok: true, content: JSON.stringify({ category: 'not-a-slug', subcategory: null, materials: [] }) }),
    })
    expect((await offSchema.task!(goldenItem({ query: 'q' }, null), arm, { itemRunId: 'r' })).ok).toBe(false)
  })

  it('decide runs the intentParse Jev candidate on {query}', async () => {
    const decide = fakeDecide({
      category: { choice: 'home', probabilities: { home: 0.92 } },
      wood: { noul: 0.8 },
    })
    const adapter = adapterFor('intent-parse-golden', { decide })
    const result = await adapter.decide!(goldenItem({ query: 'a query' }, null), { itemRunId: 'run-1' })
    expect(result.ok).toBe(true)
    expect(result.output).toMatchObject({ category: 'home', materials: ['wood'] })
    expect(vi.mocked(decide).mock.calls[0]?.[0]).toBe('intentParse')
    expect(vi.mocked(decide).mock.calls[0]?.[1]).toEqual({ query: 'a query' })
  })

  it('expectedSchema takes {category, subcategory, materials} and rejects a null label', () => {
    const { expectedSchema } = adapterFor('intent-parse-golden')
    expect(expectedSchema.safeParse({ category: 'home', subcategory: null, materials: [] }).success).toBe(true)
    // Null expectedOutput is only legal on ARCHIVED (unlabelled) items, which cmdRun never reads.
    expect(expectedSchema.safeParse(null).success).toBe(false)
  })

  it('expectedSchema accepts a null L1, as intentParseShape does, and categoryAgreement scores it', () => {
    const adapter = adapterFor('intent-parse-golden')
    const label = { category: null, subcategory: null, materials: [] }
    expect(adapter.expectedSchema.safeParse(label).success).toBe(true)

    const categoryAgreement = adapter.scorers.find((s) => s.name === 'categoryAgreement')!
    const expected = adapter.expectedOf(goldenItem({ query: 'q' }, label))
    expect(categoryAgreement.fn({ category: null, subcategory: null, materials: [] }, expected)).toBe(1)
    expect(categoryAgreement.fn({ category: 'home', subcategory: null, materials: [] }, expected)).toBe(0)
  })

  it('intent scorers: materials Jaccard and nullable subcategory agreement', () => {
    const adapter = adapterFor('intent-parse-golden')
    expect(adapter.scorers.map((s) => s.name)).toEqual([
      'categoryAgreement',
      'subcategoryAgreement',
      'materialsJaccard',
    ])
    expect(adapter.scorers.filter((s) => s.nullable).map((s) => s.name)).toEqual(['subcategoryAgreement'])

    const score = (name: string, o: unknown, e: unknown) =>
      adapter.scorers.find((s) => s.name === name)!.fn(o, adapter.expectedOf(goldenItem({ query: 'q' }, e)))

    const expected = { category: 'home', subcategory: 'tableware', materials: ['wood', 'ceramic'] }

    expect(score('categoryAgreement', { category: 'home', subcategory: null, materials: [] }, expected)).toBe(1)
    expect(score('categoryAgreement', { category: 'beauty', subcategory: null, materials: [] }, expected)).toBe(0)
    expect(score('categoryAgreement', { category: null, subcategory: null, materials: [] }, expected)).toBe(0)

    // Subcategory: n/a when neither side names one; otherwise exact agreement.
    const noSub = { ...expected, subcategory: null }
    expect(score('subcategoryAgreement', { category: 'home', subcategory: null, materials: [] }, noSub)).toBeNull()
    expect(score('subcategoryAgreement', { category: 'home', subcategory: 'tableware', materials: [] }, expected)).toBe(1)
    expect(score('subcategoryAgreement', { category: 'home', subcategory: null, materials: [] }, expected)).toBe(0)
    expect(score('subcategoryAgreement', { category: 'home', subcategory: 'tableware', materials: [] }, noSub)).toBe(0)

    // Materials: |A ∩ B| / |A ∪ B|, with two empty sets agreeing.
    expect(score('materialsJaccard', { category: 'home', subcategory: null, materials: ['wood'] }, expected)).toBe(0.5)
    expect(score('materialsJaccard', { category: 'home', subcategory: null, materials: ['glass'] }, expected)).toBe(0)
    expect(
      score('materialsJaccard', { category: 'home', subcategory: null, materials: [] }, { ...expected, materials: [] }),
    ).toBe(1)
  })
})

describe('DEV-1873 golden-set adapters', () => {
  const EXPECTED_PROFILE_KEYS = {
    'acquisition-plan-golden': 'acquisition',
    'acquisition-critique-golden': 'acquisition',
    'products-repair-golden': 'products_agent',
    'products-fallback-golden': 'products',
  } as const

  it('each of the four names resolves through adapterFor, scored, with its profile key', () => {
    for (const [name, profileKey] of Object.entries(EXPECTED_PROFILE_KEYS)) {
      const adapter = adapterFor(name)
      expect(adapter.mode).toBe('scored')
      expect(adapter.profileKey).toBe(profileKey)
      expect(adapter.scorers.length).toBeGreaterThan(0)
    }
  })

  it('the critique adapter requests critique_verdict built from CritiqueVerdictSchema', () => {
    const adapter = adapterFor('acquisition-critique-golden')
    expect(adapter.promptName).toBe('acquisition-critique')
    expect(adapter.requestSchema).toEqual({
      name: 'critique_verdict',
      schema: toStrictJsonSchema(CritiqueVerdictSchema),
    })
    expect(adapter.task).toBeUndefined()
  })

  it('the fallback adapter sends the products prompt variables production sends', () => {
    const adapter = adapterFor('products-fallback-golden')
    expect(adapter.promptName).toBe('products')
    expect(Object.keys(adapter.variables ?? {}).sort()).toEqual([
      'category_list',
      'material_vocab_block',
      'subcategory_vocab_block',
      'taiwan_usage_rules',
    ])
    expect(adapter.requestSchema).toEqual(PRODUCTS_SCHEMA)
    expect(adapter.variables).toBe(PRODUCTS_PROMPT_VARIABLES)
  })

  it('the repair adapter sends the repair schema production sends', () => {
    const adapter = adapterFor('products-repair-golden')
    expect(adapter.requestSchema).toBe(REPAIR_SCHEMA)
    expect(REPAIR_SCHEMA).toEqual({
      name: 'curated_product_repair',
      schema: toStrictJsonSchema(PRODUCTS_PROPOSAL_SHAPE.pick({ products: true })),
    })
  })

  it('only the plan adapter carries a custom task', () => {
    expect(typeof adapterFor('acquisition-plan-golden').task).toBe('function')
    expect(adapterFor('products-repair-golden').task).toBeUndefined()
    expect(adapterFor('products-fallback-golden').task).toBeUndefined()
  })

  it('rule-only adapters read { context } from expectedOutput; critique reads { verdict }', () => {
    const context = { siteUrl: 'https://brand.example', candidates: [], ownedHosts: [] }
    expect(adapterFor('products-fallback-golden').expectedOf({ expectedOutput: { context } })).toEqual({ context })
    expect(adapterFor('products-repair-golden').expectedOf({ expectedOutput: { context } })).toEqual({ context })
    expect(adapterFor('acquisition-critique-golden').expectedOf({ expectedOutput: { verdict: 'thin' } })).toEqual({
      verdict: 'thin',
    })
    expect(adapterFor('acquisition-critique-golden').expectedSchema.safeParse({ verdict: 'thin' }).success).toBe(true)
    expect(adapterFor('products-fallback-golden').expectedSchema.safeParse({ context }).success).toBe(true)
  })

  it('critique drafts a schema-valid { verdict } with the reason as rationale (DEV-1880)', () => {
    const adapter = adapterFor('acquisition-critique-golden')
    const draft = adapter.draftExpected!({
      verdict: 'thin',
      reason: 'only the homepage was read',
      recoveryAction: 'fanout',
      urlVerdicts: null,
    })
    expect(draft).toEqual({ expectedOutput: { verdict: 'thin' }, rationale: 'only the homepage was read' })
    expect(adapter.expectedSchema.safeParse(draft.expectedOutput).success).toBe(true)
  })

  it('only the critique adapter can draft labels', () => {
    expect(adapterFor('acquisition-plan-golden').draftExpected).toBeUndefined()
    expect(adapterFor('products-agent-ranking-golden').draftExpected).toBeUndefined()
  })
})
