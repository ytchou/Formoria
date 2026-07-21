import { describe, expect, it, vi } from 'vitest'
import type { PostHogQueryClient, PostHogQueryResult } from '@/lib/adapters/posthog/query-api'
import {
  getAnalyticsDateWindows,
  getPostHogAnalyticsSnapshot,
} from './posthog-analytics'

function result(columns: string[], row: unknown[]): PostHogQueryResult {
  return { columns, results: [row] }
}

const coreColumns = [
  'available_from',
  'current_unique_visitors',
  'prior_unique_visitors',
  'current_public_sessions',
  'prior_public_sessions',
  'current_pageviews',
  'prior_pageviews',
  'current_brand_profile_sessions',
  'prior_brand_profile_sessions',
  'current_outbound_sessions',
  'prior_outbound_sessions',
]

function client(overrides: Partial<Record<string, PostHogQueryResult | Error>> = {}): PostHogQueryClient {
  return {
    run: vi.fn(async (name) => {
      const override = overrides[name]
      if (override instanceof Error) throw override
      if (override) return override
      if (name === 'personal os core totals') {
        return result(coreColumns, ['2026-06-01', 100, 80, 90, 70, 130, 110, 45, 35, 20, 15])
      }
      if (name === 'personal os daily trend') {
        return {
          columns: ['date', 'unique_visitors', 'public_sessions', 'pageviews', 'brand_profile_sessions', 'outbound_sessions'],
          results: [['2026-07-19', 10, 9, 13, 4, 2]],
        }
      }
      if (name === 'personal os acquisition') {
        return { columns: ['source', 'medium', 'sessions'], results: [['Direct', 'direct', 50]] }
      }
      return {
        columns: ['brand_id', 'brand_profile_sessions', 'outbound_sessions'],
        results: [['brand-a', 12, 4]],
      }
    }),
  }
}

describe('PostHog analytics service', () => {
  it('builds Taipei windows ending yesterday', () => {
    expect(getAnalyticsDateWindows('2026-07-20', 7, 28)).toEqual({
      current: { startDate: '2026-07-13', endDate: '2026-07-19' },
      prior: { startDate: '2026-07-06', endDate: '2026-07-12' },
      trend: { startDate: '2026-06-22', endDate: '2026-07-19' },
    })
  })

  it('normalizes core totals, session funnel rates, daily data, acquisition, and hydrated brands', async () => {
    const queryClient = client()
    const snapshot = await getPostHogAnalyticsSnapshot({
      queryClient,
      hydrateBrands: vi.fn().mockResolvedValue([{ id: 'brand-a', name: 'Alpha', slug: 'alpha' }]),
      now: () => new Date('2026-07-20T08:00:00+08:00'),
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
      cache: false,
    })

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      dataThrough: '2026-07-19',
      timeZone: 'Asia/Taipei',
      audience: {
        uniqueVisitors: { current: 100, prior: 80 },
        publicSessions: { current: 90, prior: 70 },
        pageviews: { current: 130, prior: 110 },
      },
      discovery: {
        brandProfileSessions: { current: 45, prior: 35 },
        outboundSessions: { current: 20, prior: 15 },
        brandReachRate: { current: 0.5, prior: 0.5 },
        outboundConversion: { current: 20 / 45, prior: 15 / 35 },
      },
      completeness: { comparisonReady: true, warnings: [] },
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
    })
    expect(snapshot.topBrands).toEqual([
      { brandId: 'brand-a', brandName: 'Alpha', brandSlug: 'alpha', brandProfileSessions: 12, outboundSessions: 4 },
    ])
    expect(vi.mocked(queryClient.run).mock.calls.every(([, query]) =>
      query.includes('properties.analytics_schema_version = 1'),
    )).toBe(true)
    const acquisitionSql = vi.mocked(queryClient.run).mock.calls.find(
      ([name]) => name === 'personal os acquisition',
    )?.[1]
    expect(acquisitionSql).toContain(
      "properties.$session_id IN (SELECT DISTINCT properties.$session_id FROM events WHERE event = '$pageview'",
    )
    expect(acquisitionSql).toContain(
      "argMin(coalesce(properties.$utm_source, ''), timestamp)",
    )
    expect(acquisitionSql).toContain(
      "argMin(coalesce(properties.$referring_domain, ''), timestamp)",
    )
    expect(acquisitionSql).toContain("BETWEEN toDate('2026-07-12') AND toDate('2026-07-19')")
  })

  it('returns null rates for zero denominators and null prior values while the baseline is incomplete', async () => {
    const zeroCore = result(coreColumns, ['2026-07-06', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const snapshot = await getPostHogAnalyticsSnapshot({
      queryClient: client({ 'personal os core totals': zeroCore }),
      hydrateBrands: vi.fn().mockResolvedValue([]),
      now: () => new Date('2026-07-20T08:00:00+08:00'),
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
      cache: false,
    })

    expect(snapshot.discovery.brandReachRate).toEqual({ current: null, prior: null })
    expect(snapshot.discovery.outboundConversion).toEqual({ current: null, prior: null })
    expect(snapshot.audience.uniqueVisitors.prior).toBeNull()
    expect(snapshot.completeness).toMatchObject({ comparisonReady: false, availableFrom: '2026-07-06' })
  })

  it('keeps core totals when optional breakdowns fail and exposes warnings instead of empty arrays', async () => {
    const snapshot = await getPostHogAnalyticsSnapshot({
      queryClient: client({
        'personal os acquisition': new Error('outage'),
        'personal os top brands': new Error('outage'),
      }),
      hydrateBrands: vi.fn(),
      now: () => new Date('2026-07-20T08:00:00+08:00'),
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
      cache: false,
    })

    expect(snapshot.audience.publicSessions.current).toBe(90)
    expect(snapshot.acquisition).toBeNull()
    expect(snapshot.topBrands).toBeNull()
    expect(snapshot.completeness.warnings).toEqual([
      'Acquisition breakdown is temporarily unavailable.',
      'Top brands breakdown is temporarily unavailable.',
    ])
  })

  it('caches complete snapshots for the same window but not partial failures', async () => {
    const completeClient = client()
    const options = {
      queryClient: completeClient,
      hydrateBrands: vi.fn().mockResolvedValue([{ id: 'brand-a', name: 'Alpha', slug: 'alpha' }]),
      now: () => new Date('2026-07-20T08:00:00+08:00'),
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/cache-success',
    }

    await getPostHogAnalyticsSnapshot(options)
    await getPostHogAnalyticsSnapshot(options)
    expect(completeClient.run).toHaveBeenCalledTimes(4)

    const partialClient = client({ 'personal os acquisition': new Error('outage') })
    const partialOptions = {
      ...options,
      queryClient: partialClient,
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/cache-partial',
    }
    await getPostHogAnalyticsSnapshot(partialOptions)
    await getPostHogAnalyticsSnapshot(partialOptions)
    expect(partialClient.run).toHaveBeenCalledTimes(8)
  })
})
