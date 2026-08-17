import { describe, expect, it } from 'vitest'
import {
  canonicalizeRegion,
  normalizeStockistRow,
  type StockistCsvRow,
} from './normalize'

function row(overrides: Partial<StockistCsvRow> = {}): StockistCsvRow {
  return {
    brand_slug: 'hanchor',
    name: '登山友 中山店',
    location_type: 'stockist',
    channel_type: 'offline',
    region_label: '臺北市',
    address: '臺北市中正區中山北路一段18號',
    url: 'https://example.com/shops/zhongshan',
    evidence_url: 'https://hanchor.com.tw/pages/stockists',
    source_type: 'official_website',
    source_chain: 'brand stockist directory',
    confidence: 'high',
    notes: '',
    ...overrides,
  }
}

describe('stockist normalization', () => {
  it('canonicalizes the common Taipei spellings', () => {
    expect(['台北', '台北市', '臺北市'].map(canonicalizeRegion)).toEqual([
      { ok: true, regionLabel: '臺北市', country: 'TW' },
      { ok: true, regionLabel: '臺北市', country: 'TW' },
      { ok: true, regionLabel: '臺北市', country: 'TW' },
    ])
  })

  it('rejects an unmapped Taiwan-looking region rather than passing it through', () => {
    expect(canonicalizeRegion('臺北都')).toEqual({
      ok: false,
      reason: 'unmapped Taiwan region: 臺北都',
    })
  })

  it('accepts every supported location type', () => {
    const types = [
      'stockist',
      'distributor_retailer',
      'direct_store',
      'department_store_counter',
      'showroom_studio',
      'shop_in_shop',
      'other_physical_retail',
    ] as const
    const labels = types.map((locationType) => {
      const result = normalizeStockistRow(
        row({ location_type: locationType }),
      )
      return result.ok ? result.row.candidate.locationType : result.reason
    })

    expect(labels).toEqual([
      ...types,
    ])
  })

  it('resolves countries from region prefixes and rejects an unknown foreign region', () => {
    expect(canonicalizeRegion('香港')).toEqual({
      ok: true,
      regionLabel: '香港',
      country: 'HK',
    })
    expect(canonicalizeRegion('美國・New York')).toEqual({
      ok: true,
      regionLabel: '美國・New York',
      country: 'US',
    })
    expect(canonicalizeRegion('火星・Olympus Mons')).toEqual({
      ok: false,
      reason: 'unmapped foreign region: 火星・Olympus Mons',
    })
  })

  it('keeps a row with no address as a null address', () => {
    const result = normalizeStockistRow(row({ address: '  ' }))

    expect(result.ok && result.row.candidate.address).toBeNull()
  })

  it('preserves the national-chain region sentinel', () => {
    const result = normalizeStockistRow(row({ region_label: '全台多間門市' }))

    expect(result.ok && result.row.candidate.regionLabel).toBe('全台多間門市')
  })

  it('derives district from the address for a matched row', () => {
    const result = normalizeStockistRow(
      row({ address: '104臺北市中山區樂群二路199號2樓' }),
    )

    expect(result.ok && result.row.candidate.district).toBe('中山區')
  })

  it('leaves district null when the address does not match', () => {
    const result = normalizeStockistRow(
      row({ region_label: '臺中市', address: '臺中市台灣大道三段251號9樓' }),
    )

    expect(result.ok).toBe(true)
    expect(result.ok && result.row.candidate.district).toBeNull()
  })

  it('leaves district null for a non-TW row', () => {
    const result = normalizeStockistRow(
      row({ region_label: '日本・東京', address: '東京都渋谷区神宮前1-1' }),
    )

    expect(result.ok && result.row.candidate.district).toBeNull()
  })
})
