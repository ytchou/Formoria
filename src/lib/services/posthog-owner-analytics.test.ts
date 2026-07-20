import { describe, expect, it, vi } from 'vitest'
import type { PostHogQueryClient } from '@/lib/adapters/posthog/query-api'
import { getPostHogOwnerAnalyticsSnapshot } from './posthog-owner-analytics'

function queryClient(): PostHogQueryClient {
  return {
    run: vi.fn(async (name) => {
      if (name === 'owner core totals') {
        return {
          columns: ['available_from', 'current_profile_sessions', 'prior_profile_sessions', 'current_outbound_sessions', 'prior_outbound_sessions'],
          results: [['2026-05-01', 30, 20, 12, 5]],
        }
      }
      if (name === 'owner daily trend') {
        return {
          columns: ['date', 'profile_sessions', 'outbound_sessions'],
          results: [['2026-07-19', 3, 1]],
        }
      }
      if (name === 'owner acquisition') {
        return { columns: ['source', 'medium', 'sessions'], results: [['Direct', 'direct', 10]] }
      }
      return { columns: ['destination', 'sessions'], results: [['website', 8]] }
    }),
  }
}

describe('PostHog owner analytics', () => {
  it('uses session-based 30-day metrics ending yesterday', async () => {
    const client = queryClient()
    const snapshot = await getPostHogOwnerAnalyticsSnapshot('brand-uuid', {
      queryClient: client,
      now: () => new Date('2026-07-20T08:00:00+08:00'),
      sourceUrl: 'https://us.posthog.com/project/123/dashboard/456',
      cache: false,
    })

    expect(snapshot.windows).toEqual({
      current: { startDate: '2026-06-20', endDate: '2026-07-19' },
      prior: { startDate: '2026-05-21', endDate: '2026-06-19' },
      trend: { startDate: '2026-06-20', endDate: '2026-07-19' },
    })
    expect(snapshot.profileSessions).toEqual({ current: 30, prior: 20 })
    expect(snapshot.outboundSessions).toEqual({ current: 12, prior: 5 })
    expect(snapshot.outboundConversion).toEqual({ current: 0.4, prior: 0.25 })
    expect(snapshot.destinations).toEqual([{ destination: 'website', sessions: 8 }])
    expect(vi.mocked(client.run).mock.calls.every(([, query]) =>
      query.includes('properties.analytics_schema_version = 1'),
    )).toBe(true)
    const acquisitionSql = vi.mocked(client.run).mock.calls.find(
      ([name]) => name === 'owner acquisition',
    )?.[1]
    expect(acquisitionSql).toContain(
      "properties.$session_id IN (SELECT DISTINCT properties.$session_id FROM events WHERE event = 'brand_detail_viewed'",
    )
  })
})
