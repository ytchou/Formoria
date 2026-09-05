import { describe, expect, it } from 'vitest'
import { isFreshSearchResult, type SearchResultRow } from '../search-results'

function makeRow(overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    brandId: 'brand-1',
    searchType: 'serp',
    query: 'test',
    urls: ['https://example.com'],
    snippets: [],
    ...overrides,
  }
}

const THREE_DAYS_MS = 3 * 86_400_000

describe('isFreshSearchResult', () => {
  const now = new Date('2026-09-04T00:00:00Z').getTime()

  it('rejects rows older than the max age', () => {
    const row = makeRow({
      createdAt: new Date('2026-08-30T00:00:00Z').toISOString(), // 5 days ago
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })

  it('accepts rows within the max age', () => {
    const row = makeRow({
      createdAt: new Date('2026-09-03T00:00:00Z').toISOString(), // 1 day ago
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(true)
  })

  it('rejects rows with no URLs regardless of age', () => {
    const row = makeRow({
      createdAt: new Date('2026-09-03T12:00:00Z').toISOString(),
      urls: [],
    })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })

  it('rejects rows with no createdAt', () => {
    const row = makeRow({ createdAt: undefined })
    expect(isFreshSearchResult(row, THREE_DAYS_MS, now)).toBe(false)
  })
})
