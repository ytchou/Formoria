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

  it('maps generic networks to channels and named branches or counters to physical leads', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        stockists: [
          { name: ' 寶雅 ', city: 'taipei', type: 'chain' },
          { name: ' 誠品生活松菸店 ', city: ' taipei ', type: 'independent' },
          { name: ' 新光三越台北信義新天地 A11 3F 專櫃 ', city: 'taipei', type: 'independent' },
        ],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['Stockist source material.'],
    })

    const locations = result.patch.retail_locations as Array<Record<string, unknown>>
    expect(locations).toHaveLength(3)
    expect(locations.at(0)).toMatchObject({
      kind: 'retail_chain',
      name: '寶雅',
    })
    expect(locations.at(0)).not.toHaveProperty('city')
    expect(locations.at(0)).not.toHaveProperty('relationshipType')
    expect(locations.at(0)).not.toHaveProperty('confirmationStatus')
    expect(locations.at(1)).toMatchObject({
      kind: 'location',
      name: '誠品生活松菸店',
      relationshipType: 'stockist',
      city: 'taipei',
      confirmationStatus: 'unconfirmed',
    })
    expect(locations.at(2)).toMatchObject({
      kind: 'location',
      name: '新光三越台北信義新天地 A11 3F 專櫃',
      relationshipType: 'stockist',
      city: 'taipei',
      confirmationStatus: 'unconfirmed',
    })
    expect(locations.every((location) => !('type' in location))).toBe(true)
    expect(result.phaseResult.changedFields).toContain('retail_locations')
  })

  it('normalizes merged records without losing rich existing data or duplicating vague leads', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        stockists: [
          { name: ' Existing Location ', city: 'New City', type: 'independent' },
          { name: ' EXISTING   CHAIN ', city: 'Ignored', type: 'chain' },
          { name: 'Existing Location', city: null, type: 'chain' },
          { name: 'New Location', city: 'Kaohsiung', type: 'independent' },
        ],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand: {
        ...brand,
        retail_locations: [
          {
            kind: 'location',
            name: 'Existing Location',
            relationshipType: 'stockist',
            address: 'No. 1',
            city: 'Taipei',
            district: 'Xinyi',
            venueName: 'Existing Venue',
            floorOrCounter: '3F',
            availabilityNote: 'Call before visiting',
            latitude: 25.033,
            longitude: 121.565,
            verificationStatus: 'verified',
            confirmationStatus: 'owner_confirmed',
          },
          {
            kind: 'retail_chain',
            name: 'Existing Chain',
            retailerUrl: 'https://retailer.example/shops',
            availabilityNote: 'Selected stores',
          },
        ],
      },
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['Stockist source material.'],
    })

    const locations = result.patch.retail_locations as Array<Record<string, unknown>>
    expect(locations).toHaveLength(4)
    expect(locations.at(0)).toMatchObject({
      kind: 'location',
      name: 'Existing Location',
      relationshipType: 'stockist',
      address: 'No. 1',
      city: 'Taipei',
      district: 'Xinyi',
      venueName: 'Existing Venue',
      floorOrCounter: '3F',
      availabilityNote: 'Call before visiting',
      latitude: 25.033,
      longitude: 121.565,
      verificationStatus: 'verified',
      confirmationStatus: 'owner_confirmed',
    })
    expect(locations.at(1)).toMatchObject({
      kind: 'retail_chain',
      name: 'Existing Chain',
      retailerUrl: 'https://retailer.example/shops',
      availabilityNote: 'Selected stores',
    })
    expect(locations.at(2)).toMatchObject({
      kind: 'retail_chain',
      name: 'Existing Location',
    })
    expect(locations.at(3)).toMatchObject({
      kind: 'location',
      name: 'New Location',
      city: 'Kaohsiung',
      confirmationStatus: 'unconfirmed',
    })
  })

  it('preserves owner-confirmed locations during overwrite without confirming new leads', async () => {
    const confirmedLocation = {
      kind: 'location' as const,
      name: 'Confirmed Location',
      relationshipType: 'brand_store' as const,
      address: 'Owner-confirmed address',
      city: 'Taipei',
      district: 'Xinyi',
      venueName: 'Owner Venue',
      floorOrCounter: '3F',
      availabilityNote: 'Owner note',
      latitude: 25.033,
      longitude: 121.565,
      verificationStatus: 'verified' as const,
      confirmationStatus: 'owner_confirmed' as const,
    }
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({
        stockists: [
          { name: 'Confirmed Location', city: 'Changed City', type: 'chain' },
          { name: 'New Lead', city: 'Taichung', type: 'independent' },
        ],
      }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand: {
        ...brand,
        retail_locations: [
          confirmedLocation,
          {
            kind: 'location',
            name: 'Old Lead',
            relationshipType: 'stockist',
            confirmationStatus: 'unconfirmed',
          },
        ],
      },
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['Stockist source material.'],
      overwrite: true,
    })

    const locations = result.patch.retail_locations as Array<Record<string, unknown>>
    expect(locations).toHaveLength(2)
    expect(locations.at(0)).toEqual(confirmedLocation)
    expect(locations.at(1)).toMatchObject({
      name: 'New Lead',
      city: 'Taichung',
      confirmationStatus: 'unconfirmed',
    })
    expect(locations).not.toContainEqual(expect.objectContaining({ name: 'Old Lead' }))
    expect(
      locations.filter((location) => location.confirmationStatus === 'owner_confirmed'),
    ).toHaveLength(1)
  })

  it('preserves owner-confirmed locations when overwrite finds no stockists', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({ stockists: null }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand: {
        ...brand,
        retail_locations: [
          {
            kind: 'location',
            name: 'Confirmed Location',
            relationshipType: 'brand_store',
            address: 'No. 2',
            confirmationStatus: 'owner_confirmed',
          },
          {
            kind: 'location',
            name: 'Unconfirmed Lead',
            relationshipType: 'stockist',
            confirmationStatus: 'unconfirmed',
          },
        ],
      },
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['No stockists found.'],
      overwrite: true,
    })

    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({
        name: 'Confirmed Location',
        address: 'No. 2',
        confirmationStatus: 'owner_confirmed',
      }),
    ])
    expect(result.phaseResult.changedFields).toContain('retail_locations')
  })

  it('tracks an explicit retail_locations clear as a changed field', async () => {
    rewriteBrandDescription.mockResolvedValue({
      result: makeDescriptionRewriteResult({ stockists: null }),
      attempts: [],
    })

    const result = await runDescriptionsPhase({
      brand: {
        ...brand,
        retail_locations: [
          {
            kind: 'location',
            name: 'Unconfirmed Lead',
            relationshipType: 'stockist',
            confirmationStatus: 'unconfirmed',
          },
        ],
      },
      phases: ['descriptions'] as EnrichPhase[],
      serpSnippets: ['No stockists found.'],
      overwrite: true,
    })

    expect(result.patch.retail_locations).toBeNull()
    expect(result.phaseResult.changedFields).toContain('retail_locations')
  })

})
