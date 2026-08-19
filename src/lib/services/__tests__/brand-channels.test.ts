import { describe, expect, it } from 'vitest'

import {
  buildEnrichedChannelRows,
  buildStockistPageRanges,
  CHANNEL_READ_SELECT,
  groupStockistsForCity,
  matchesCategory,
  stockistDistrictSlugs,
  summarizeStockistCities,
  type StockistLocation,
} from '../brand-channels'

function location(id: string, district: string | null): StockistLocation {
  return {
    id,
    name: `María García Stockist ${id}`,
    address: `臺北市${district ?? ''}南京東路1號`,
    url: null,
    country: 'TW',
    city: 'taipei',
    district,
    brandSlug: `maria-garcia-${id}`,
    brandName: `María García ${id}`,
    categorySlug: 'home',
    subcategories: [],
  }
}

describe('brand channel provenance', () => {
  it('forwards imported provenance into the RPC row payload', () => {
    const { rows, invalidCount } = buildEnrichedChannelRows([
      {
        name: '好丘 信義店',
        normalizedName: '好丘信義',
        channelType: 'offline',
        regionLabel: '臺北市',
        address: '臺北市信義區松勤街54號',
        url: 'https://www.goodcho.com.tw/stores/xinyi',
        source: 'import',
        sourceUrl: 'https://www.goodcho.com.tw/stores',
        fetchedAt: '2026-08-11T07:00:00.000Z',
        locationType: 'stockist',
        country: 'TW',
        providerMetadata: {
          sourceChain: 'official directory',
          confidence: 'high',
        },
      },
    ])

    expect(invalidCount).toBe(0)
    expect(rows).toEqual([
      expect.objectContaining({
        source: 'import',
        source_url: 'https://www.goodcho.com.tw/stores',
        fetched_at: '2026-08-11T07:00:00.000Z',
        location_type: 'stockist',
        country: 'TW',
        provider_metadata: {
          sourceChain: 'official directory',
          confidence: 'high',
        },
      }),
    ])
  })

  it('defaults legacy enriched candidates to the enriched source', () => {
    const { rows } = buildEnrichedChannelRows([
      {
        name: '誠品生活松菸店',
        normalizedName: '誠品生活松菸',
        channelType: 'offline',
      },
    ])

    expect(rows.at(0)?.source).toBe('enriched')
  })

  it('selects every provenance field exposed on a displayed channel', () => {
    expect(CHANNEL_READ_SELECT).toContain('source_url')
    expect(CHANNEL_READ_SELECT).toContain('fetched_at')
    expect(CHANNEL_READ_SELECT).toContain('location_type')
    expect(CHANNEL_READ_SELECT).toContain('country')
  })

  it('orders district sections by location count and leaves unmatched locations last', () => {
    const locations = [
      location('alpha', '信義區'),
      location('bravo', '中山區'),
      location('charlie', '中山區'),
      location('delta', null),
    ]

    expect(
      groupStockistsForCity(locations, 'taipei').map((group) => group.slug),
    ).toEqual(['taipei-zhongshan', 'taipei-xinyi', 'unassigned'])
  })

  it('summarizes only cities that have real locations', () => {
    expect(summarizeStockistCities([location('echo', '中山區')])).toMatchObject(
      [{ city: 'taipei', count: 1 }],
    )
  })

  it('requests every stockist page when the directory exceeds the Data API row cap', () => {
    expect(buildStockistPageRanges(1_354)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1353 },
    ])
  })

  it('offers location jumps only for district sections present in the directory', () => {
    expect(
      stockistDistrictSlugs([
        location('foxtrot', '中山區'),
        location('golf', '中山區'),
        location('hotel', null),
      ]),
    ).toEqual(['taipei-zhongshan'])
  })
})

describe('stockist category filter over slug-stored subcategories', () => {
  function stockist(subcategories: string[]): StockistLocation {
    return {
      ...location('india', '中山區'),
      categorySlug: 'bags-accessories',
      subcategories,
    }
  }

  // A multi-word slug is the load-bearing case: 'tote-bags' normalizes to
  // neither nameZh nor an alias, so a name-keyed lookup resolves it to null and
  // the whole city page renders empty. The 58 single-word slugs pass either way.
  it('matches a brand whose stored subcategory is a multi-word slug', () => {
    expect(matchesCategory(stockist(['tote-bags']), 'tote-bags')).toBe(true)
  })

  it('still matches a pre-migration zh-TW label for the same node', () => {
    expect(matchesCategory(stockist(['托特包']), 'tote-bags')).toBe(true)
  })

  it('does not match a different L2 of the same L1', () => {
    expect(matchesCategory(stockist(['tote-bags']), 'backpacks')).toBe(false)
  })

  it('matches on the brand L1 and passes everything through with no filter', () => {
    expect(matchesCategory(stockist([]), 'bags-accessories')).toBe(true)
    expect(matchesCategory(stockist([]), undefined)).toBe(true)
  })
})
