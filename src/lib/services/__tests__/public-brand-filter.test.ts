import { describe, expect, it } from 'vitest'

import { excludeTestBrands, TEST_BRAND_NAME_PATTERN } from '../public-brand-filter'

type NotCall = [string, string, string]

/**
 * Structurally satisfies the `excludeTestBrands` constraint without any Supabase
 * machinery: the real PostgrestFilterBuilder also returns itself from `.not()`.
 */
function createQuerySpy() {
  const calls: NotCall[] = []
  const query = {
    calls,
    not(column: string, operator: string, value: string) {
      calls.push([column, operator, value])
      return query
    },
  }
  return query
}

describe('excludeTestBrands', () => {
  it('applies exactly one not-like filter on the brand name', () => {
    const query = createQuerySpy()

    excludeTestBrands(query)

    expect(query.calls).toEqual([['name', 'like', '[E2E-TEST]%']])
  })

  it('returns the same query so it stays chainable', () => {
    const query = createQuerySpy()

    expect(excludeTestBrands(query)).toBe(query)
  })
})

describe('TEST_BRAND_NAME_PATTERN', () => {
  it('matches the prefix e2e specs seed brands under', () => {
    expect(TEST_BRAND_NAME_PATTERN).toBe('[E2E-TEST]%')
  })
})
