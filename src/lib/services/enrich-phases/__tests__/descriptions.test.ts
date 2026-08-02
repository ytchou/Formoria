import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DescriptionRewriteResult } from '../../description-rewrite'
import type { EnrichBrand } from '../types'

const { rewriteBrandDescription } = vi.hoisted(() => ({
  rewriteBrandDescription: vi.fn(),
}))

vi.mock('../../description-rewrite', () => ({ rewriteBrandDescription }))

vi.mock('@/lib/supabase/server', () => {
  // Every read this phase makes ends in `.limit()`; returning no rows keeps the
  // test on the LLM verdict, which is the thing under test.
  const query: Record<string, unknown> = {}
  query.select = () => query
  query.eq = () => query
  query.order = () => query
  query.limit = () => Promise.resolve({ data: [], error: null })
  return { createServiceClient: () => ({ from: () => query }) }
})

import { runDescriptionsPhase } from '../descriptions'

const rewriteResult = (over: Partial<DescriptionRewriteResult> = {}): DescriptionRewriteResult =>
  ({
    description_zh: null,
    description_en: null,
    description: null,
    blurb_zh: null,
    blurb_en: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    city: null,
    foundingYear: null,
    reputationSummary: null,
    faq: null,
    stockists: null,
    mitIndicators: null,
    validationRejections: [],
    ...over,
  }) as DescriptionRewriteResult

const brand = (over: Partial<EnrichBrand> = {}): EnrichBrand => ({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'a-brand',
  name: 'A Brand',
  description: '既有的品牌描述',
  ...over,
})

// A refresh always runs with overwrite on, and only then is a non-empty field
// eligible to be rewritten — or emptied.
const run = (brandRow: EnrichBrand) =>
  runDescriptionsPhase({
    brand: brandRow,
    phases: ['descriptions'],
    serpSnippets: ['某個搜尋摘要'],
    overwrite: true,
    dryRun: true,
  })

describe('runDescriptionsPhase — _cleared_fields', () => {
  beforeEach(() => {
    rewriteBrandDescription.mockReset()
  })

  it('emits a clear when the rewrite found no reputation and the brand has one', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: rewriteResult({ reputationSummary: null }),
      attempts: [],
    })

    const { patch, phaseResult } = await run(
      brand({ reputation_summary: { text: '過時的媒體評價', sources: [] } }),
    )

    expect(patch._cleared_fields).toEqual(['reputation_summary'])
    expect(phaseResult.changedFields).toContain('reputation_summary')
  })

  it('emits nothing when the brand has no reputation to clear', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: rewriteResult({ reputationSummary: null }),
      attempts: [],
    })

    const { patch } = await run(brand({ reputation_summary: null }))

    expect(patch).not.toHaveProperty('_cleared_fields')
  })

  it('emits nothing when the rewrite produced a reputation', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: rewriteResult({
        reputationSummary: { text: '新的媒體評價', textEn: null, sources: [] },
      }),
      attempts: [],
    })

    const { patch } = await run(
      brand({ reputation_summary: { text: '過時的媒體評價', sources: [] } }),
    )

    expect(patch).not.toHaveProperty('_cleared_fields')
    expect(patch.reputation_summary).toMatchObject({ text: '新的媒體評價' })
  })

  // Silence, not a verdict: a failed LLM call must never empty a field.
  it('emits nothing when the phase produced no rewrite at all', async () => {
    rewriteBrandDescription.mockResolvedValue(null)

    const { patch } = await run(
      brand({ reputation_summary: { text: '過時的媒體評價', sources: [] } }),
    )

    expect(patch).not.toHaveProperty('_cleared_fields')
    expect(patch).toEqual({})
  })
})
