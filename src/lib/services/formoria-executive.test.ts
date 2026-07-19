import { describe, expect, it, vi } from 'vitest'
import { getExecutiveDateWindows, getFormoriaExecutiveSnapshot } from './formoria-executive'

describe('Formoria executive snapshot', () => {
  it('uses complete seven-day windows ending at T-2', () => {
    expect(getExecutiveDateWindows('2026-07-19')).toEqual({
      current: { startDate: '2026-07-11', endDate: '2026-07-17' },
      prior: { startDate: '2026-07-04', endDate: '2026-07-10' },
    })
  })

  it('combines normalized business data with cached health', async () => {
    const business = {
      supply: { approvedBrands: 120, newApproved: { current: 8, prior: 5 }, claimedShare: 0.25 },
      audience: { confirmedSubscribers: 42, netConfirmations: { current: 6, prior: 3 } },
      engagement: { topBrands: [], destinationMix: [] },
      curation: { activeJobs: 1, latestOutcome: null },
    }
    const dataSource = { load: vi.fn().mockResolvedValue(business) }
    const health = {
      status: 'healthy' as const,
      checkedAt: '2026-07-19T00:00:00Z',
      services: [],
    }

    const result = await getFormoriaExecutiveSnapshot({
      dataSource,
      getHealth: vi.fn().mockResolvedValue(health),
      now: () => new Date('2026-07-19T08:00:00+08:00'),
    })

    expect(dataSource.load).toHaveBeenCalledWith({
      current: { startDate: '2026-07-11', endDate: '2026-07-17' },
      prior: { startDate: '2026-07-04', endDate: '2026-07-10' },
    })
    expect(result).toMatchObject({ schemaVersion: 1, ...business, systemStatus: health })
  })
})
