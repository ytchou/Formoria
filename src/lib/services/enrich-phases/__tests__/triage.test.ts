import { describe, expect, it } from 'vitest'
import {
  applyTriageResult,
  runStandaloneClassification,
  runTriagePhase,
} from '../triage'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'
import type { TriageResult } from '../../product-type-classifier'

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  description: 'Original description',
  product_type: null,
  purchase_website: 'https://test.example',
}

const brandTriage: TriageResult = {
  isNonBrand: false,
  nonBrandReason: null,
  slug: 'test-brand',
  slugGenerated: 'better-brand',
  productType: 'skincare',
  valueTags: ['vegan'],
  confidence: 'high',
}

function ctx(overrides: Partial<BatchPhaseContext> = {}): BatchPhaseContext {
  return {
    chunk: [brand],
    chunkBrandNames: ['Test Brand'],
    phases: ['detect'] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext['supabase'],
    ...overrides,
  }
}

describe('runTriagePhase', () => {
  it('returns skipped when no triage phases requested', async () => {
    const result = await runTriagePhase(ctx({ phases: ['links'] as EnrichPhase[] }), new Map())

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.triageResults.size).toBe(0)
  })
})

describe('runStandaloneClassification', () => {
  it('skips standalone classification when tags phase is not requested', async () => {
    const result = await runStandaloneClassification(
      ctx({ phases: ['descriptions'] as EnrichPhase[] })
    )

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.batchClassifications.size).toBe(0)
  })
})

describe('applyTriageResult', () => {
  it('returns non-brand skip result for high-confidence non-brands', () => {
    const result = applyTriageResult(
      {
        ...brandTriage,
        isNonBrand: true,
        nonBrandReason: 'directory',
      },
      brand
    )

    expect(result.isNonBrand).toBe(true)
    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns brand result with triage patch for valid brands', () => {
    const result = applyTriageResult(brandTriage, brand)

    expect(result.isNonBrand).toBe(false)
    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.patch).toEqual({
      slug: 'better-brand',
      product_type: 'skincare',
      tag_slugs: ['vegan'],
    })
  })
})
