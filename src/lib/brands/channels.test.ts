import { describe, expect, it } from 'vitest'
import {
  groupChannelsByKind,
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

  it('normalizeChannelName strips whitespace, case, and retailer noise suffixes', () => {
    expect(normalizeChannelName('登山友 店')).toBe(normalizeChannelName('登山友'))
    expect(normalizeChannelName('登山友\t店')).toBe(normalizeChannelName('登山友'))
    expect(normalizeChannelName('登山友 內湖店')).not.toBe(
      normalizeChannelName('登山友'),
    )
    expect(normalizeChannelName('登山友')).not.toBe(normalizeChannelName('登山王'))
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

    expect(result.confirmed[0]).toMatchObject({ hasCurrentUserConfirmed: true })
    expect(result.possible[0]).toMatchObject({ hasCurrentUserConfirmed: false })
  })
})

describe('groupChannelsByKind', () => {
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

  it('uses the ordered kind precedence and omits empty groups', () => {
    const groups = groupChannelsByKind([
      channel({
        id: 'online',
        name: '線上',
        channelType: 'online',
      }),
      channel({
        id: 'chain',
        name: '連鎖',
      }),
      channel({
        id: 'visitable',
        name: '可造訪',
        address: '台北市',
      }),
      channel({
        id: 'official',
        name: '官方',
        source: 'owner',
        ownerStatus: 'confirmed',
        status: 'confirmed',
      }),
      channel({
        id: 'official-with-address',
        name: '官方有地址',
        source: 'owner',
        ownerStatus: 'confirmed',
        status: 'confirmed',
        address: '台北市',
      }),
    ])

    expect(groups.map((group) => group.key)).toEqual([
      'official',
      'visitable',
      'chain',
      'online',
    ])
    expect(groups[0].channels.map((item) => item.id)).toEqual([
      'official',
      'official-with-address',
    ])
  })

  it('omits kinds that have no channels', () => {
    const groups = groupChannelsByKind([
      channel({ id: 'chain-only', name: '連鎖' }),
    ])

    expect(groups.map((group) => group.key)).toEqual(['chain'])
  })

  it('sorts confirmed first, then confirmations, then name', () => {
    const groups = groupChannelsByKind([
      channel({
        id: 'unconfirmed-high',
        name: 'A',
        confirmationCount: 9,
      }),
      channel({
        id: 'confirmed-low',
        name: 'C',
        status: 'confirmed',
      }),
      channel({
        id: 'confirmed-high',
        name: 'B',
        status: 'confirmed',
        confirmationCount: 3,
      }),
      channel({
        id: 'unconfirmed-name-b',
        name: 'E',
        confirmationCount: 1,
      }),
      channel({
        id: 'unconfirmed-name-a',
        name: 'D',
        confirmationCount: 1,
      }),
    ])

    expect(groups[0].channels.map((item) => item.id)).toEqual([
      'confirmed-high',
      'confirmed-low',
      'unconfirmed-high',
      'unconfirmed-name-a',
      'unconfirmed-name-b',
    ])
  })
})
