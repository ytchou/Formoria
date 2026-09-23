import { describe, it, expect } from 'vitest'
import {
  parsePageParam,
  parseSortParam,
  BRAND_SORT_CONFIG,
} from './pagination'

describe('parsePageParam', () => {
  it.each([
    ['undefined', undefined],
    ['a non-numeric string', 'abc'],
    ['zero', '0'],
    ['a negative number', '-3'],
    ['an array', ['1', '2']],
  ])('returns 1 for %s', (_label, raw) => {
    expect(parsePageParam(raw)).toBe(1)
  })

  it('parses valid page number', () => {
    expect(parsePageParam('3')).toBe(3)
  })

  it('rejects fractional and oversized pages before deriving a database offset', () => {
    expect(parsePageParam('2.5')).toBe(1)
    expect(parsePageParam('178956972')).toBe(1)
  })
})

describe('parseSortParam', () => {
  it.each([
    ['undefined', undefined],
    ['an unknown value', 'invalid'],
    ['an array', ['name', 'newest']],
  ])('returns "random" for %s', (_label, raw) => {
    expect(parseSortParam(raw)).toBe('random')
  })

  it('returns valid sort option', () => {
    expect(parseSortParam('newest')).toBe('newest')
    expect(parseSortParam('year')).toBe('year')
    expect(parseSortParam('name')).toBe('name')
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
