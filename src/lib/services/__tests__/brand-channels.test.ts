import { describe, expect, it } from 'vitest'

import {
  buildEnrichedChannelRows,
  CHANNEL_READ_SELECT,
} from '../brand-channels'

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
})
