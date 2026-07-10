import { describe, expect, it } from 'vitest'
import {
  applyDetectResult,
  runStandaloneClassification,
  runDetectPhase,
} from '../detect'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'
import type { DetectResult } from '../../product-type-classifier'

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  description: 'Original description',
  product_type: null,
  purchase_website: 'https://test.example',
}

const brandDetect: DetectResult = {
  isNonBrand: false,
  nonBrandReason: null,
  brandName: null,
  slug: 'test-brand',
  slugGenerated: 'better-brand',
  productType: 'skincare',
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

describe('runDetectPhase', () => {
  it('returns skipped when no detect phases requested', async () => {
    const result = await runDetectPhase(ctx({ phases: ['links'] as EnrichPhase[] }), new Map())

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.detectResults.size).toBe(0)
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

describe('applyDetectResult', () => {
  it('returns non-brand skip result for high-confidence non-brands', () => {
    const result = applyDetectResult(
      {
        ...brandDetect,
        isNonBrand: true,
        nonBrandReason: 'directory',
      },
      brand
    )

    expect(result.isNonBrand).toBe(true)
    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns brand result with detect patch for valid brands', () => {
    const result = applyDetectResult(brandDetect, brand)

    expect(result.isNonBrand).toBe(false)
    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.patch).toEqual({
      slug: 'better-brand',
      product_type: 'skincare',
    })
  })
})
