import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DescriptionRewriteResult } from '../../description-rewrite'
import { runDescriptionsPhase } from '../descriptions'
import type { EnrichBrand, EnrichPhase } from '../types'

const supabaseMocks = vi.hoisted(() => ({
  data: null as unknown[] | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: supabaseMocks.data }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('../../description-rewrite', () => ({
  rewriteBrandDescription: vi.fn(),
}))

const { rewriteBrandDescription } = vi.mocked(await import('../../description-rewrite'))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  description: null,
}

function makeDescriptionRewriteResult(
  overrides: Partial<DescriptionRewriteResult>,
): DescriptionRewriteResult {
  return {
    description_zh: null,
    description_en: null,
    description: null,
    priceRange: null,
    productTags: [],
    city: null,
    foundingYear: null,
    signatureProducts: [],
    whereToBuy: null,
    categoryMismatch: false,
    validationRejections: [],
    ...overrides,
  }
}

describe('runDescriptionsPhase', () => {
  beforeEach(() => {
    rewriteBrandDescription.mockReset()
    supabaseMocks.data = null
  })

  it('returns skipped when descriptions is not in requested phases', async () => {
    const result = await runDescriptionsPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      scrapedData: {
        description: 'A long enough brand description from scraped data.',
      },
      serpSnippets: ['Snippet'],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns skipped when no scraped data and no snippets available', async () => {
    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.detail).toContain('no description')
    expect(result.patch).toEqual({})
  })

  it('includes price_range in patch when classification returns a value', async () => {
    rewriteBrandDescription.mockResolvedValue(makeDescriptionRewriteResult({
      description: 'Test Brand creates considered everyday accessories for modern homes.',
      priceRange: 2,
      productTags: [],
    }))

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Known for ceramic cups priced around $80.'],
    })

    expect(result.patch.price_range).toBe(2)
  })

  it('includes product_tags in patch when extraction returns products', async () => {
    rewriteBrandDescription.mockResolvedValue(makeDescriptionRewriteResult({
      description: 'Test Brand creates considered everyday accessories for modern homes.',
      priceRange: null,
      productTags: ['ceramic mugs', 'linen placemats'],
    }))

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Offers ceramic mugs and linen placemats for the table.'],
    })

    expect(result.patch.product_tags).toEqual(['ceramic mugs', 'linen placemats'])
  })

  it('tracks price_range and product_tags in changedFields', async () => {
    rewriteBrandDescription.mockResolvedValue(makeDescriptionRewriteResult({
      description_zh: 'Test Brand creates considered everyday accessories for modern homes.',
      priceRange: 3,
      productTags: ['leather totes', 'silk scarves'],
    }))

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Sells leather totes and silk scarves above $200.'],
    })

    expect(result.phaseResult.changedFields).toEqual(['description', 'price_range', 'product_tags'])
  })

})
