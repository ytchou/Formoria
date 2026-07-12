import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DescriptionRewriteResult } from '../../description-rewrite'
import { loadPersistedScrapeText, runDescriptionsPhase } from '../descriptions'
import type { EnrichBrand, EnrichPhase } from '../types'

const supabaseMocks = vi.hoisted(() => ({
  data: null as unknown[] | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'product_tag_translations') {
        return {
          upsert: () => Promise.resolve({ error: null }),
          select: () => ({
            in: () => Promise.resolve({ data: [] }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: supabaseMocks.data }),
              }),
            }),
          }),
        }),
      }
    },
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
    productTagsEn: [],
    blurb_zh: null,
    blurb_en: null,
    city: null,
    foundingYear: null,
    reputationSummary: null,
    faq: null,
    stockists: null,
    mitIndicators: null,
    validationRejections: [],
    ...overrides,
  }
}

describe('loadPersistedScrapeText', () => {
  beforeEach(() => {
    supabaseMocks.data = null
  })

  it('includes stockistPageText in siteContent when present', async () => {
    supabaseMocks.data = [
      {
        urls: ['https://example.com'],
        snippets: [],
        raw_response: {
          stockistPageText: '寶雅',
        },
      },
    ]

    const result = await loadPersistedScrapeText('brand-id')
    expect(result.siteContent).toContain('Stockist Page:')
    expect(result.siteContent).toContain('寶雅')
  })
})

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
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        description: 'Test Brand creates considered everyday accessories for modern homes.',
        priceRange: 2,
        productTags: [],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Known for ceramic cups priced around $80.'],
    })

    expect(result.patch.price_range).toBe(2)
  })

  it('includes product_tags in patch when extraction returns products', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        description: 'Test Brand creates considered everyday accessories for modern homes.',
        priceRange: null,
        productTags: ['斜背包', '口金包'],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Offers crossbody bags and clasp-frame bags.'],
    })

    expect(result.patch.product_tags).toEqual(['斜背包', '口金包'])
  })

  it('tracks price_range and product_tags in changedFields', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        description_zh: 'Test Brand creates considered everyday accessories for modern homes.',
        priceRange: 3,
        productTags: ['斜背包', '口金包'],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: ['Sells crossbody bags and clasp-frame bags above $200.'],
    })

    expect(result.phaseResult.changedFields).toEqual(['description', 'price_range', 'product_tags', 'product_tags_en'])
  })

})
