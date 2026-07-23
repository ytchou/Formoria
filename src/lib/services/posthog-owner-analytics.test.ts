import { describe, expect, it, vi } from 'vitest'
import { getPostHogOwnerAnalyticsSnapshot } from './posthog-owner-analytics'

function endpointClientMock(responses: Record<string, unknown[][] | Error>) {
  return {
    runEndpoint: vi.fn(async (
      name: string,
      _version: number,
      _variables: Record<string, string>,
    ) => {
      const r = responses[name]
      if (r instanceof Error) throw r
      return { results: r, columns: [] }
    }),
  }
}

const happy = {
  brand_core_totals: [['2026-05-01', 120, 100, 24, 18]],
  brand_daily_trend: [['2026-07-01', 10, 2], ['2026-07-02', 14, 3]],
  brand_traffic_sources: [['search', 52], ['category', 30], ['direct', 18]],
  brand_outbound_destinations: [['website', 12], ['instagram', 6]],
}

describe('getPostHogOwnerAnalyticsSnapshot (endpoints)', () => {
  it('passes computed date range for daysBack=7', async () => {
    const client = endpointClientMock(happy)

    await getPostHogOwnerAnalyticsSnapshot('b-1', {
      client,
      daysBack: 7,
      now: () => new Date('2026-07-20T12:00:00+08:00'),
    })

    expect(client.runEndpoint).toHaveBeenCalledTimes(4)
    for (const call of client.runEndpoint.mock.calls) {
      expect(call[1]).toBe(2)
      expect(call[2]).toEqual({
        brand_id: 'b-1',
        current_start: '2026-07-13',
        current_end: '2026-07-19',
        prior_start: '2026-07-06',
        prior_end: '2026-07-12',
      })
    }
  })

  it('defaults to 30 days', async () => {
    const client = endpointClientMock(happy)

    await getPostHogOwnerAnalyticsSnapshot('b-1', { client })

    expect(client.runEndpoint).toHaveBeenCalledTimes(4)
    for (const call of client.runEndpoint.mock.calls) {
      expect(call[1]).toBe(1)
      expect(call[2]).toEqual({ brand_id: 'b-1' })
    }
  })

  it('maps endpoint rows into the snapshot with derived rate and top source', async () => {
    const snap = await getPostHogOwnerAnalyticsSnapshot('b-1', { client: endpointClientMock(happy) })
    expect(snap.profileSessions).toEqual({ current: 120, prior: 100 })
    expect(snap.outboundConversion?.current).toBeCloseTo(0.2)
    expect(snap.trafficSources?.[0]).toEqual({ source: 'search', sessions: 52 })
    expect(snap.topTrafficSource).toEqual({ source: 'search', share: 0.52 })
    expect(snap.completeness.warnings).toEqual([])
    expect(snap.completeness.availableFrom).toBe('2026-05-01')
    expect(snap).not.toHaveProperty('acquisition')
    expect(snap).not.toHaveProperty('sourceUrl')
  })

  it('degrades one failed endpoint to a null section + warning, others intact', async () => {
    const snap = await getPostHogOwnerAnalyticsSnapshot('b-1', {
      client: endpointClientMock({ ...happy, brand_traffic_sources: new Error('boom') }),
    })
    expect(snap.trafficSources).toBeNull()
    expect(snap.topTrafficSource).toBeNull()
    expect(snap.completeness.warnings.length).toBe(1)
    expect(snap.profileSessions).toEqual({ current: 120, prior: 100 })
  })

  it('serves no in-memory cache: two calls hit endpoints twice', async () => {
    const client = endpointClientMock(happy)
    await getPostHogOwnerAnalyticsSnapshot('b-1', { client })
    await getPostHogOwnerAnalyticsSnapshot('b-1', { client })
    expect(client.runEndpoint).toHaveBeenCalledTimes(8)
  })
})
