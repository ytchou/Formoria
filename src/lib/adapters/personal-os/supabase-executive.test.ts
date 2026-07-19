import { describe, expect, it } from 'vitest'
import { summarizeExecutiveBusinessData } from './supabase-executive'

const windows = {
  current: { startDate: '2026-07-11', endDate: '2026-07-17' },
  prior: { startDate: '2026-07-04', endDate: '2026-07-10' },
}

describe('Supabase executive projection', () => {
  it('summarizes supply, active subscribers, engagement, and curation without mixed denominators', () => {
    const result = summarizeExecutiveBusinessData(
      {
        brands: [
          { id: 'a', name: 'Alpha', slug: 'alpha', approved_at: '2026-07-12T00:00:00Z' },
          { id: 'b', name: 'Beta', slug: 'beta', approved_at: '2026-07-08T00:00:00Z' },
          { id: 'c', name: 'Gamma', slug: 'gamma', approved_at: null },
        ],
        owners: [{ brand_id: 'a' }, { brand_id: 'not-approved' }],
        subscribers: [
          { confirmed_at: '2026-07-12T00:00:00Z', unsubscribed_at: null },
          { confirmed_at: '2026-07-13T00:00:00Z', unsubscribed_at: '2026-07-15T00:00:00Z' },
          { confirmed_at: '2026-07-05T00:00:00Z', unsubscribed_at: null },
        ],
        analytics: [
          { brand_id: 'a', views: 10, clicks: 3 },
          { brand_id: 'a', views: 4, clicks: 1 },
          { brand_id: 'b', views: 8, clicks: 5 },
        ],
        links: [
          { destination: 'website', clicks: 4 },
          { destination: 'website', clicks: 3 },
          { destination: 'instagram', clicks: 2 },
        ],
        activeJobs: 2,
        latestJob: {
          id: 'job-1',
          status: 'completed',
          completed_at: '2026-07-18T00:00:00Z',
          failed_count: 1,
          target_total: 10,
        },
      },
      windows,
    )

    expect(result.supply).toEqual({
      approvedBrands: 3,
      newApproved: { current: 1, prior: 1 },
      claimedShare: 1 / 3,
    })
    expect(result.audience).toEqual({
      confirmedSubscribers: 2,
      netConfirmations: { current: 1, prior: 1 },
    })
    expect(result.engagement.topBrands[0]).toMatchObject({ slug: 'alpha', views: 14, clicks: 4 })
    expect(result.engagement.destinationMix).toEqual([
      { destination: 'website', clicks: 7 },
      { destination: 'instagram', clicks: 2 },
    ])
    expect(result.curation).toMatchObject({ activeJobs: 2, latestOutcome: { failedCount: 1 } })
  })

  it('uses zero for claimed share when no approved brands exist', () => {
    const result = summarizeExecutiveBusinessData(
      {
        brands: [],
        owners: [],
        subscribers: [],
        analytics: [],
        links: [],
        activeJobs: 0,
        latestJob: null,
      },
      windows,
    )

    expect(result.supply.claimedShare).toBe(0)
  })
})
