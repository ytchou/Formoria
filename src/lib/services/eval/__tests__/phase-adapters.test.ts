import { describe, expect, it } from 'vitest'
import { adapterFor } from '../phase-adapters'
import { toStrictJsonSchema } from '../../_shared/zod-schema'
import { isHighConfidenceWrite } from '../../enrich-phases/detect'

const GOLDEN_DATASET_NAMES = [
  'detect-confidence-golden',
  'category-confidence-golden',
  'name-arbiter-confidence-golden',
  'site-identity-confidence-golden',
  'products-editorial-score-golden',
] as const

describe('phase-adapters registry', () => {
  it('resolves each of the five golden dataset names plus descriptions', () => {
    for (const name of GOLDEN_DATASET_NAMES) {
      const adapter = adapterFor(name)
      expect(adapter).toBeDefined()
      expect(adapter.promptName).toEqual(expect.any(String))
      expect(adapter.fallbackPrompt).toEqual(expect.any(String))
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

    // products-editorial-score-golden has review-only mode
    const products = adapterFor('products-editorial-score-golden')
    expect(products.mode).toBe('review-only')
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
})

describe('isHighConfidenceWrite', () => {
  it('is true only for confidence high', () => {
    expect(isHighConfidenceWrite({ confidence: 'high' })).toBe(true)
    expect(isHighConfidenceWrite({ confidence: 'medium' })).toBe(false)
    expect(isHighConfidenceWrite({ confidence: 'low' })).toBe(false)
  })
})
