import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DescriptionRewriteResult } from '../../description-rewrite'
import { loadPersistedScrapeText, runDescriptionsPhase } from '../descriptions'
import type { EnrichBrand, EnrichPhase } from '../types'

const supabaseMocks = vi.hoisted(() => ({
  data: null as unknown[] | null,
  upsert: vi.fn(() => Promise.resolve({ error: null })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'product_tag_translations') {
        return {
          upsert: supabaseMocks.upsert,
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
    supabaseMocks.upsert.mockClear()
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

  it('fills missing English copy without overwriting populated fields', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        description_zh: '新的中文介紹',
        description_en: 'New English description.',
        blurb_zh: '新的中文摘要',
        blurb_en: 'New English summary.',
        priceRange: 3,
        productTags: ['新標籤'],
        productTagsEn: ['New tag'],
        foundingYear: 2020,
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand: {
        ...brand,
        description: '既有中文介紹',
        description_en: null,
        blurb: '既有中文摘要',
        blurb_en: null,
        price_range: 2,
        product_tags: ['既有標籤'],
        product_tags_en: ['Existing tag'],
        founding_year: 2018,
      },
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['Existing source material.'],
      overwrite: false,
    })

    expect(result.patch).toMatchObject({
      description_en: 'New English description.',
      blurb_en: 'New English summary.',
    })
    expect(result.patch).not.toHaveProperty('description')
    expect(result.patch).not.toHaveProperty('blurb')
    expect(result.patch).not.toHaveProperty('price_range')
    expect(result.patch).not.toHaveProperty('product_tags')
    expect(result.patch).not.toHaveProperty('product_tags_en')
    expect(result.patch).not.toHaveProperty('founding_year')
  })

  it('does not persist tag translations during a dry run', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        productTags: ['標籤'],
        productTagsEn: ['Tag'],
      }),
      attempts: [],
    })

    await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['Existing source material.'],
      dryRun: true,
    })

    expect(supabaseMocks.upsert).not.toHaveBeenCalled()
  })

})
