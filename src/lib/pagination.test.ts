import { describe, it, expect } from 'vitest'
import {
  parsePageParam,
  parseSortParam,
  DEFAULT_PAGE_SIZE,
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
})

describe('parseSortParam', () => {
  it('returns "name" for undefined', () => {
    expect(parseSortParam(undefined)).toBe('name')
  })

  it('returns "name" for invalid sort value', () => {
    expect(parseSortParam('invalid')).toBe('name')
  })

  it('returns valid sort option', () => {
    expect(parseSortParam('newest')).toBe('newest')
    expect(parseSortParam('year')).toBe('year')
    expect(parseSortParam('name')).toBe('name')
  })

  it('returns "name" for array input', () => {
    expect(parseSortParam(['name', 'newest'])).toBe('name')
  })
})

describe('constants', () => {
  it('DEFAULT_PAGE_SIZE is 12', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(12)
  })

  it('BRAND_SORT_CONFIG has entries for all sort options', () => {
    expect(BRAND_SORT_CONFIG.name).toEqual({
      column: 'name',
      ascending: true,
      label: 'A-Z',
    })
    expect(BRAND_SORT_CONFIG.newest).toEqual({
      column: 'created_at',
      ascending: false,
      label: '最新',
    })
    expect(BRAND_SORT_CONFIG.year).toEqual({
      column: 'founding_year',
      ascending: false,
      label: '創立年份',
    })
  })
})
