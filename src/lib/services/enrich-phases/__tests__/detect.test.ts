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

  // `tags` belongs to the DETAIL step and detect no longer produces a category,
  // so a tags-only run must not pay for a detect LLM call.
  it('does not trigger detect for a tags-only run', async () => {
    const result = await runDetectPhase(ctx({ phases: ['tags'] as EnrichPhase[] }), new Map())

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
    expect(result.patch).toEqual({ slug: 'better-brand' })
  })

  // DETECT_SYSTEM_PROMPT tells the model to return a null slug rather than
  // transliterate a Han name. The model obeys; the generateSlug fallback then
  // Wade-Giles romanised it anyway (`yuan-hsing-tung-fang-cha-yin-pur-sweets`).
  it('leaves the slug untouched for a Han name with no model slug', () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: '茶籽堂 Cha Tzu Tang' },
      { ...brand, name: '茶籽堂', slug: 'chatzutang' }
    )

    expect(result.patch.name).toBe('茶籽堂 Cha Tzu Tang')
    expect(result.patch).not.toHaveProperty('slug')
  })

  it('still generates a slug for a Latin name with no model slug', () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: 'ADELA Studio' },
      { ...brand, name: 'Adela', slug: 'adela' }
    )

    expect(result.patch.slug).toBe('adela-studio')
  })

  it('never writes product_type, even when tags is requested', () => {
    // The category moved to the descriptions phase, which sees the brand's own
    // site text and its classified image alt text. Detect sees SERP snippets.
    const result = applyDetectResult(
      { ...brandDetect, productType: 'beauty' },
      brand,
      ['detect', 'slugs', 'tags'] as EnrichPhase[]
    )

    expect(result.patch).not.toHaveProperty('product_type')
  })
})
