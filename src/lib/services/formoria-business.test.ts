import { describe, expect, it, vi } from 'vitest'
import { getFormoriaBusinessSnapshot } from './formoria-business'

describe('Formoria business snapshot', () => {
  it('uses seven-day Taipei windows ending yesterday and returns only business growth', async () => {
    const dataSource = {
      load: vi.fn().mockResolvedValue({
        supply: {
          approvedBrands: 120,
          newApproved: { current: 8, prior: 5 },
          claimedShare: 0.25,
        },
        audience: {
          confirmedSubscribers: 42,
          netConfirmations: { current: 6, prior: 3 },
        },
      }),
    }

    const snapshot = await getFormoriaBusinessSnapshot({
      dataSource,
      now: () => new Date('2026-07-20T08:00:00+08:00'),
    })

    expect(dataSource.load).toHaveBeenCalledWith({
      current: { startDate: '2026-07-13', endDate: '2026-07-19' },
      prior: { startDate: '2026-07-06', endDate: '2026-07-12' },
    })
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      dataThrough: '2026-07-19',
      timeZone: 'Asia/Taipei',
      supply: { approvedBrands: 120 },
      audience: { confirmedSubscribers: 42 },
    })
    expect(snapshot).not.toHaveProperty('engagement')
    expect(snapshot).not.toHaveProperty('systemStatus')
  })
})
