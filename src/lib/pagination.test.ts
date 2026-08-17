import { describe, it, expect } from 'vitest'
import {
  parsePageParam,
  parseSortParam,
  BRAND_SORT_CONFIG,
} from './pagination'

describe('parsePageParam', () => {
  it('returns 1 for undefined', () => {
    expect(parsePageParam(undefined)).toBe(1)
  })

  it('returns 1 for non-numeric string', () => {
    expect(parsePageParam('abc')).toBe(1)
  })

  it('returns 1 for zero', () => {
    expect(parsePageParam('0')).toBe(1)
  })

  it('returns 1 for negative numbers', () => {
    expect(parsePageParam('-3')).toBe(1)
  })

  it('parses valid page number', () => {
    expect(parsePageParam('3')).toBe(3)
  })

  it('returns 1 for array input', () => {
    expect(parsePageParam(['1', '2'])).toBe(1)
  })

  it('rejects fractional and oversized pages before deriving a database offset', () => {
    expect(parsePageParam('2.5')).toBe(1)
    expect(parsePageParam('178956972')).toBe(1)
  })
})

describe('parseSortParam', () => {
  it('returns "random" for undefined', () => {
    expect(parseSortParam(undefined)).toBe('random')
  })

  it('returns "random" for invalid sort value', () => {
    expect(parseSortParam('invalid')).toBe('random')
  })

  it('returns valid sort option', () => {
    expect(parseSortParam('newest')).toBe('newest')
    expect(parseSortParam('year')).toBe('year')
    expect(parseSortParam('name')).toBe('name')
  })

  it('returns "random" for array input', () => {
    expect(parseSortParam(['name', 'newest'])).toBe('random')
  })
})

describe('constants', () => {
  // `BRAND_SORT_CONFIG` is typed `Record<BrandSortOption, …>`, so completeness
  // is already a compile error — transcribing every entry's value here only
  // restated the source. What the types do NOT enforce is the empty-column
  // sentinel: an empty `column` means "no ORDER BY", so a new sort option that
  // forgot its column would silently return unsorted rows rather than fail.
  it('reserves the empty-column sentinel for random ordering alone', () => {
    for (const [option, config] of Object.entries(BRAND_SORT_CONFIG)) {
      if (option === 'random') {
        expect(config.column).toBe('')
      } else {
        expect(config.column).not.toBe('')
      }
      expect(config.label).not.toBe('')
    }
  })

  // Every configured option must survive a round trip through the parser,
  // which gates on `raw in BRAND_SORT_CONFIG`.
  it('parses every configured sort option back to itself', () => {
    for (const option of Object.keys(BRAND_SORT_CONFIG)) {
      expect(parseSortParam(option)).toBe(option)
    }
  })
})
