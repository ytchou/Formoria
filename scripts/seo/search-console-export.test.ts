import { describe, expect, it } from 'vitest'
import {
  assertSearchConsoleCredentials,
  buildScorecard,
  type SearchConsolePageRow,
  type SearchConsoleQueryRow,
} from './search-console-export'

function queryRow(
  query: string,
  impressions: number,
  clicks: number,
  position: number,
): SearchConsoleQueryRow {
  return { query, impressions, clicks, ctr: impressions === 0 ? 0 : clicks / impressions, position }
}

function pageRow(
  page: string,
  impressions: number,
  clicks: number,
  position: number,
): SearchConsolePageRow {
  return { page, impressions, clicks, ctr: impressions === 0 ? 0 : clicks / impressions, position }
}

const fixtureQueries: SearchConsoleQueryRow[] = [
  queryRow('Formoria 台灣品牌', 20, 4, 7),
  queryRow('台灣品牌目錄', 100, 10, 2),
  queryRow('台灣品牌平台', 50, 5, 4),
  queryRow('台灣手作', 5, 1, 12),
  queryRow('Taiwanese handmade brands', 30, 3, 55),
  queryRow('quiet home objects', 10, 1, 25),
]

const fixturePages: SearchConsolePageRow[] = [
  pageRow('https://formoria.tw/brands', 100, 8, 2),
  pageRow('https://formoria.tw/en/brands', 80, 6, 3),
  pageRow('https://formoria.tw/brands/atelier-mori', 40, 4, 8),
  pageRow('https://formoria.tw/brands?category=bags', 30, 3, 12),
  pageRow('https://formoria.tw/en/brands?category=bags&subcategory=backpacks', 20, 2, 21),
  pageRow('https://formoria.tw/stories/quiet-craft', 10, 1, 60),
]

describe('Search Console scorecard export', () => {
  it('aggregates a scorecard from fixture rows', () => {
    const scorecard = buildScorecard({ queries: fixtureQueries, pages: fixturePages })

    expect(scorecard.total).toEqual({ impressions: 215, clicks: 24, ctr: 24 / 215 })
    expect(scorecard.nonBrand).toEqual({ impressions: 195, clicks: 20, ctr: 20 / 195 })
    expect(scorecard.branded).toEqual({ impressions: 20, clicks: 4, ctr: 0.2 })
    expect(scorecard.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cluster: 'core-taiwan-brand',
          impressions: 150,
          clicks: 15,
          ctr: 0.1,
          averagePosition: (100 * 2 + 50 * 4) / 150,
        }),
        expect.objectContaining({
          cluster: 'english',
          impressions: 30,
          clicks: 3,
          averagePosition: 55,
        }),
        expect.objectContaining({ cluster: 'unclassified', impressions: 10, clicks: 1 }),
      ]),
    )
  })

  it('buckets queries by average position', () => {
    const scorecard = buildScorecard({
      queries: [
        queryRow('台灣品牌三', 1, 1, 3),
        queryRow('台灣品牌十', 1, 1, 10),
        queryRow('台灣品牌二十', 1, 1, 20),
        queryRow('台灣品牌五十', 1, 1, 50),
        queryRow('台灣品牌五十一', 1, 1, 51),
        // Search Console positions are decimals, so a fractional value between
        // two integer boundaries must still land in a bucket.
        queryRow('台灣品牌三點五', 1, 1, 3.5),
      ],
      pages: [],
    })

    expect(scorecard.positionBuckets).toEqual({
      '1-3': 1,
      '4-10': 2,
      '11-20': 1,
      '21-50': 1,
      '50+': 1,
    })
  })

  it('separates branded from non-branded totals', () => {
    const scorecard = buildScorecard({ queries: fixtureQueries, pages: [] })

    expect(scorecard.branded).toEqual({ impressions: 20, clicks: 4, ctr: 0.2 })
    expect(scorecard.nonBrand).toEqual({ impressions: 195, clicks: 20, ctr: 20 / 195 })
    expect(scorecard.total.impressions).toBe(
      scorecard.branded.impressions + scorecard.nonBrand.impressions,
    )
    expect(scorecard.total.clicks).toBe(scorecard.branded.clicks + scorecard.nonBrand.clicks)
  })

  it('groups landing pages by canonical page type', () => {
    const scorecard = buildScorecard({ queries: [], pages: fixturePages })

    expect(scorecard.pageTypes.directory).toEqual({ impressions: 180, clicks: 14, ctr: 14 / 180 })
    expect(scorecard.pageTypes['l1-category']).toEqual({ impressions: 30, clicks: 3, ctr: 0.1 })
    expect(scorecard.pageTypes['l2-category']).toEqual({ impressions: 20, clicks: 2, ctr: 0.1 })
    expect(scorecard.l1Pages['https://formoria.tw/brands?category=bags']).toBe(30)
    expect(scorecard.l2Pages['https://formoria.tw/en/brands?category=bags&subcategory=backpacks']).toBe(
      20,
    )
    expect(scorecard.landingPages.map(({ page }) => page)).toEqual([
      'https://formoria.tw/brands',
      'https://formoria.tw/en/brands',
      'https://formoria.tw/brands/atelier-mori',
      'https://formoria.tw/brands?category=bags',
      'https://formoria.tw/en/brands?category=bags&subcategory=backpacks',
      'https://formoria.tw/stories/quiet-craft',
    ])
  })

  it('exits with a named error when credentials are absent', () => {
    expect(() => assertSearchConsoleCredentials({})).toThrow(
      expect.objectContaining({ name: 'MissingSearchConsoleCredentialsError' }),
    )
    expect(() => assertSearchConsoleCredentials({})).toThrow(
      /GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON.*create a GCP service account.*read access.*\.env\.local/i,
    )
  })
})
