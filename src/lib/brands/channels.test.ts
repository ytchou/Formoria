import { describe, expect, it } from 'vitest'
import {
  groupChannelsByRegion,
  groupChannelsForDisplay,
  normalizeChannelName,
} from './channels'
import type { BrandChannel } from '@/lib/types/brand-channel'

type ChannelRow = {
  id: string
  name: string
  channelType: string
  categoryLabel: string | null
  regionLabel: string | null
  address: string | null
  url: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  locationType?: string | null
  country?: string | null
  ownerStatus: string
  source: string
  confirmationCount: number
  removedAt: string | null
}

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: 'channel-1',
    name: '登山友',
    channelType: 'online',
    categoryLabel: null,
    regionLabel: null,
    address: null,
    url: null,
    ownerStatus: 'none',
    source: 'backfill',
    confirmationCount: 0,
    removedAt: null,
    ...overrides,
  }
}

describe('groupChannelsForDisplay', () => {
  it('groups owner-confirmed channel into confirmed with owner provenance', () => {
    const result = groupChannelsForDisplay([
      channelRow({ ownerStatus: 'confirmed', confirmationCount: 0 }),
    ])

    expect(result.confirmed).toEqual([
      expect.objectContaining({
        status: 'confirmed',
        confirmedBy: 'owner',
      }),
    ])
    expect(result.possible).toEqual([])
  })

  it('promotes at exactly the threshold', () => {
    const result = groupChannelsForDisplay([
      channelRow({ id: 'channel-2', confirmationCount: 2 }),
      channelRow({ id: 'channel-3', confirmationCount: 3 }),
    ])

    expect(result.possible).toEqual([
      expect.objectContaining({
        id: 'channel-2',
        status: 'unconfirmed',
      }),
    ])
    expect(result.confirmed).toEqual([
      expect.objectContaining({
        id: 'channel-3',
        status: 'confirmed',
        confirmedBy: 'community',
      }),
    ])
  })

  it('owner provenance wins over community', () => {
    const result = groupChannelsForDisplay([
      channelRow({ ownerStatus: 'confirmed', confirmationCount: 5 }),
    ])

    expect(result.confirmed[0]).toMatchObject({
      status: 'confirmed',
      confirmedBy: 'owner',
    })
  })

  it('marks an imported source-backed row as evidence confirmed', () => {
    const result = groupChannelsForDisplay([
      channelRow({
        source: 'import',
        sourceUrl: 'https://hanchor.com.tw/pages/stockists',
      }),
    ])

    expect(result.confirmed.at(0)).toMatchObject({
      status: 'confirmed',
      confirmedBy: 'evidence',
    })
  })

  it('does not treat a community row with a source URL as evidence backed', () => {
    const result = groupChannelsForDisplay([
      channelRow({
        source: 'community',
        sourceUrl: 'https://example.com/community-submission',
      }),
    ])

    expect(result.possible.at(0)).toMatchObject({ status: 'unconfirmed' })
  })

  it('normalizeChannelName strips whitespace, case, and retailer noise suffixes', () => {
    expect(normalizeChannelName('登山友 店')).toBe(
      normalizeChannelName('登山友'),
    )
    expect(normalizeChannelName('登山友\t店')).toBe(
      normalizeChannelName('登山友'),
    )
    expect(normalizeChannelName('登山友 內湖店')).not.toBe(
      normalizeChannelName('登山友'),
    )
    expect(normalizeChannelName('登山友')).not.toBe(
      normalizeChannelName('登山王'),
    )
  })

  it('normalizeChannelName strips compound suffixes sequentially', () => {
    // '登山友門市專賣店': strip '專賣店' → '登山友門市', then strip '門市' → '登山友'
    expect(normalizeChannelName('登山友門市專賣店')).toBe('登山友')
    // Should NOT return '登山友門市' (the old single-pass behaviour)
    expect(normalizeChannelName('登山友門市專賣店')).not.toBe('登山友門市')
    // Stripping must not reduce to empty string: '店' alone stays '店'
    expect(normalizeChannelName('店')).toBe('店')
  })

  it('excludes tombstoned and rejected channels from both groups', () => {
    const result = groupChannelsForDisplay([
      channelRow({ id: 'removed', removedAt: '2026-07-24T00:00:00Z' }),
      channelRow({ id: 'rejected', ownerStatus: 'rejected' }),
    ])

    expect(result).toEqual({ confirmed: [], possible: [] })
  })

  it('marks viewer confirmation state', () => {
    const result = groupChannelsForDisplay(
      [
        channelRow({ id: 'confirmed', ownerStatus: 'confirmed' }),
        channelRow({ id: 'possible' }),
      ],
      ['confirmed'],
    )

    expect(result.confirmed[0]).toMatchObject({
      hasCurrentUserConfirmed: true,
    })
    expect(result.possible[0]).toMatchObject({
      hasCurrentUserConfirmed: false,
    })
  })
})

describe('groupChannelsByRegion', () => {
  function channel(overrides: Partial<BrandChannel> = {}): BrandChannel {
    return {
      id: 'channel-1',
      name: '通路',
      channelType: 'offline',
      categoryLabel: null,
      regionLabel: null,
      address: null,
      url: null,
      ownerStatus: 'none',
      source: 'community',
      confirmationCount: 0,
      status: 'unconfirmed',
      ...overrides,
    }
  }

  it('groups Taiwan rows by canonical region ordered by count', () => {
    const groups = groupChannelsByRegion([
      channel({
        id: 'taipei-one',
        name: '臺北一店',
        regionLabel: '臺北市',
        country: 'TW',
      }),
      channel({
        id: 'taichung',
        name: '臺中店',
        regionLabel: '臺中市',
        country: 'TW',
      }),
      channel({
        id: 'taipei-two',
        name: '臺北二店',
        regionLabel: '臺北市',
        country: 'TW',
      }),
    ])

    expect(groups.map((group) => [group.key, group.channels.length])).toEqual([
      ['taipei', 2],
      ['taichung', 1],
    ])
  })

  it('collapses non-Taiwan rows into one overseas group', () => {
    const groups = groupChannelsByRegion([
      channel({
        id: 'hong-kong',
        name: '香港店',
        regionLabel: '香港',
        country: 'HK',
      }),
      channel({
        id: 'new-york',
        name: '紐約店',
        regionLabel: '美國・New York',
        country: 'US',
      }),
    ])

    expect(groups).toEqual([expect.objectContaining({ key: 'overseas' })])
    expect(groups.at(0)?.channels).toHaveLength(2)
  })

  it('keeps online rows in a trailing group', () => {
    const groups = groupChannelsByRegion([
      channel({
        id: 'online',
        name: '官方商城',
        channelType: 'online',
      }),
      channel({
        id: 'taipei',
        name: '臺北店',
        regionLabel: '臺北市',
        country: 'TW',
      }),
    ])

    expect(groups.map((group) => group.key)).toEqual(['taipei', 'online'])
  })
})
