import { describe, expect, it } from 'vitest'
import { adapterFor } from '../phase-adapters'
import { toStrictJsonSchema } from '../../_shared/zod-schema'
import { isHighConfidenceWrite } from '../../enrich-phases/detect'
import { CritiqueVerdictSchema } from '../../enrich-phases/acquisition/plan'
import { PRODUCTS_SCHEMA } from '../../enrich-phases/products'

const GOLDEN_DATASET_NAMES = [
  'detect-confidence-golden',
  'category-confidence-golden',
  'name-arbiter-confidence-golden',
  'site-identity-confidence-golden',
  'products-agent-ranking-golden',
] as const

describe('phase-adapters registry', () => {
  it('resolves each of the five golden dataset names plus descriptions', () => {
    for (const name of GOLDEN_DATASET_NAMES) {
      const adapter = adapterFor(name)
      expect(adapter).toBeDefined()
      expect(adapter.promptName).toEqual(expect.any(String))
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
})
