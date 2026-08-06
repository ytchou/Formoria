import { describe, expect, it, vi } from 'vitest'
import {
  assertSearchConsoleCredentials,
  buildScorecard,
  collectApiRows,
  fetchQueryRows,
  resolveWindows,
  SEARCH_CONSOLE_ROW_LIMIT,
  type SearchAnalyticsRequest,
  type SearchConsolePageRow,
  type SearchConsoleQueryRow,
} from './search-console-export'

function queryRow(
  query: string,
  impressions: number,
  clicks: number,
  position: number | null,
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
  // Same logical L1 page: locale prefix plus a non-indexable `page` parameter.
  pageRow('https://formoria.tw/en/brands?category=bags&page=2', 15, 1, 14),
  pageRow('https://formoria.tw/en/brands?category=bags&sub=backpacks', 20, 2, 21),
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

  it('treats a missing position as absent, not as a top-3 ranking', () => {
    const scorecard = buildScorecard({
      queries: [
        queryRow('台灣品牌目錄', 100, 10, 20),
        // No `position` key at all — the shape Search Console returns when it
        // has no ranking for the row.
        { query: '台灣品牌列表', impressions: 900, clicks: 0, ctr: 0 },
        queryRow('台灣品牌總覽', 100, 0, null),
      ],
      pages: [],
    })

    expect(scorecard.positionBuckets['1-3']).toBe(0)
    expect(scorecard.positionBuckets).toEqual({
      '1-3': 0,
      '4-10': 0,
      '11-20': 1,
      '21-50': 0,
      '50+': 0,
    })
    // Impressions still count toward the cluster; only the ranking is absent.
    const core = scorecard.clusters.find(({ cluster }) => cluster === 'core-taiwan-brand')
    expect(core?.impressions).toBe(1100)
    expect(core?.averagePosition).toBe(20)
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
    expect(scorecard.pageTypes['l1-category']).toEqual({ impressions: 45, clicks: 4, ctr: 4 / 45 })
    expect(scorecard.pageTypes['l2-category']).toEqual({ impressions: 20, clicks: 2, ctr: 0.1 })
  })

  it('keys l1/l2 impressions on the canonical page while landingPages stay raw', () => {
    const scorecard = buildScorecard({ queries: [], pages: fixturePages })

    // /brands?category=bags and /en/brands?category=bags&page=2 are ONE page.
    expect(scorecard.l1Pages).toEqual({ '/brands?category=bags': 45 })
    expect(scorecard.l2Pages).toEqual({ '/brands?category=bags&sub=backpacks': 20 })
    expect(scorecard.landingPages.map(({ page }) => page)).toEqual([
      'https://formoria.tw/brands',
      'https://formoria.tw/en/brands',
      'https://formoria.tw/brands/atelier-mori',
      'https://formoria.tw/brands?category=bags',
      'https://formoria.tw/en/brands?category=bags&sub=backpacks',
      'https://formoria.tw/en/brands?category=bags&page=2',
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

  describe('private key preflight', () => {
    const property = 'sc-domain:formoria.tw'
    const pemBody = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ=='

    function env(privateKey: string): Record<string, string> {
      return {
        GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: 'gsc@formoria.iam.gserviceaccount.com',
          private_key: privateKey,
        }),
        GOOGLE_SEARCH_CONSOLE_PROPERTY: property,
      }
    }

    it('normalizes double-escaped newlines into a real PEM', () => {
      const escaped = `-----BEGIN PRIVATE KEY-----\\n${pemBody}\\n-----END PRIVATE KEY-----\\n`
      const { credentials } = assertSearchConsoleCredentials(env(escaped))

      expect(credentials.private_key).toBe(
        `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`,
      )
    })

    it('accepts a well-formed PEM unchanged', () => {
      const pem = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----\n`
      const { credentials } = assertSearchConsoleCredentials(env(pem))

      expect(credentials.private_key.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true)
      expect(credentials.private_key.endsWith('-----END PRIVATE KEY-----')).toBe(true)
    })

    it('rejects a header-less key with the env var name and provisioning steps', () => {
      expect(() => assertSearchConsoleCredentials(env(pemBody))).toThrow(
        expect.objectContaining({ name: 'MissingSearchConsoleCredentialsError' }),
      )
      expect(() => assertSearchConsoleCredentials(env(pemBody))).toThrow(
        // [\s\S]* rather than /s: tsconfig targets ES2017, which predates the dotAll flag.
        /GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON[\s\S]*BEGIN PRIVATE KEY[\s\S]*create a GCP service account/,
      )
    })
  })

  describe('row pagination', () => {
    function apiRows(count: number, offset: number) {
      return Array.from({ length: count }, (_, index) => ({
        keys: [`query-${offset + index}`],
        clicks: 1,
        impressions: 2,
        ctr: 0.5,
        position: 5,
      }))
    }

    const window = { label: '90d', startDate: '2026-05-01', endDate: '2026-07-29' }

    it('stops at the first short page', async () => {
      const requests: SearchAnalyticsRequest[] = []
      const fetchPage = vi.fn(async (request: SearchAnalyticsRequest) => {
        requests.push(request)
        return apiRows(request.startRow === 0 ? request.rowLimit : 7, request.startRow)
      })

      const rows = await collectApiRows(fetchPage, window, 'query')

      expect(rows).toHaveLength(SEARCH_CONSOLE_ROW_LIMIT + 7)
      expect(requests.map(({ startRow }) => startRow)).toEqual([0, SEARCH_CONSOLE_ROW_LIMIT])
      expect(requests[0]).toMatchObject({
        startDate: '2026-05-01',
        endDate: '2026-07-29',
        dimensions: ['query'],
        dataState: 'final',
      })
    })

    it('makes exactly one request when the first page is short', async () => {
      const fetchPage = vi.fn(async () => apiRows(3, 0))

      const rows = await fetchQueryRows(fetchPage, window)

      expect(fetchPage).toHaveBeenCalledTimes(1)
      expect(rows).toEqual([
        { query: 'query-0', clicks: 1, impressions: 2, ctr: 0.5, position: 5 },
        { query: 'query-1', clicks: 1, impressions: 2, ctr: 0.5, position: 5 },
        { query: 'query-2', clicks: 1, impressions: 2, ctr: 0.5, position: 5 },
      ])
    })

    it('carries a missing position through as null rather than 0', async () => {
      const fetchPage = vi.fn(async () => [{ keys: ['台灣品牌'], clicks: 0, impressions: 4 }])

      const rows = await fetchQueryRows(fetchPage, window)

      expect(rows[0]?.position).toBeNull()
    })
  })

  describe('window resolution', () => {
    it('anchors the window on the Taipei calendar day', () => {
      // 2026-08-06T22:00Z is already 2026-08-07 06:00 in Taipei.
      const beforeTaipeiMidnight = resolveWindows(new Date('2026-08-06T14:00:00.000Z'))
      const afterTaipeiMidnight = resolveWindows(new Date('2026-08-06T22:00:00.000Z'))

      expect(beforeTaipeiMidnight[0]).toEqual({
        label: '28d',
        startDate: '2026-07-07',
        endDate: '2026-08-03',
      })
      expect(afterTaipeiMidnight[0]).toEqual({
        label: '28d',
        startDate: '2026-07-08',
        endDate: '2026-08-04',
      })
    })
  })
})
