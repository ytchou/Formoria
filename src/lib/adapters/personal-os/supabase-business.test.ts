import { describe, expect, it } from 'vitest'
import { summarizeBusinessGrowth } from './supabase-business'

describe('Supabase business projection', () => {
  it('classifies UTC timestamps by their Asia/Taipei calendar date', () => {
    const result = summarizeBusinessGrowth(
      {
        brands: [
          { id: 'current', approved_at: '2026-07-12T16:30:00.000Z' },
          { id: 'after-window', approved_at: '2026-07-19T16:30:00.000Z' },
        ],
        owners: [{ brand_id: 'current' }],
        subscribers: [
          { confirmed_at: '2026-07-12T16:30:00.000Z', unsubscribed_at: null },
          { confirmed_at: '2026-07-19T16:30:00.000Z', unsubscribed_at: null },
        ],
      },
      {
        current: { startDate: '2026-07-13', endDate: '2026-07-19' },
        prior: { startDate: '2026-07-06', endDate: '2026-07-12' },
      },
    )

    expect(result.supply.newApproved).toEqual({ current: 1, prior: 0 })
    expect(result.audience.netConfirmations).toEqual({ current: 1, prior: 0 })
    expect(result.supply.claimedShare).toBe(0.5)
  })
})
