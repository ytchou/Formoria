import { describe, expect, it, vi } from 'vitest'
import { getPostHogOwnerAnalyticsSnapshot } from './posthog-owner-analytics'

function endpointClientMock(responses: Record<string, unknown[][] | Error>) {
  return {
    runEndpoint: vi.fn(async (name: string) => {
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
