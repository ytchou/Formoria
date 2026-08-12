import { describe, expect, it } from 'vitest'

import {
  buildEnrichedChannelRows,
  CHANNEL_READ_SELECT,
  groupStockistsForCity,
  summarizeStockistCities,
  type StockistLocation,
} from '../brand-channels'

function location(
  id: string,
  district: string | null,
): StockistLocation {
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
    productType: 'home',
    productTags: [],
  }
}

describe('brand channel provenance', () => {
  it('forwards imported provenance into the RPC row payload', () => {
    const { rows, invalidCount } = buildEnrichedChannelRows([
      {
        name: '好丘 信義店',
        normalizedName: '好丘信義',
        channelType: 'offline',
        categoryLabel: '選品店',
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

    expect(groupStockistsForCity(locations, 'taipei').map((group) => group.slug)).toEqual([
      'taipei-zhongshan',
      'taipei-xinyi',
      'unassigned',
    ])
  })

  it('summarizes only cities that have real locations', () => {
    expect(summarizeStockistCities([location('echo', '中山區')])).toMatchObject([
      { city: 'taipei', count: 1 },
    ])
  })
})
