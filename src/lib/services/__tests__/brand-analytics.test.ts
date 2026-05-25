import { describe, it, expect, vi } from 'vitest'
import { incrementView, incrementClick, getAnalytics } from '../brand-analytics'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'

function makeSupabaseClient(data: unknown = null, error: unknown = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ data, error }),
  }
  ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  return chain
}

describe('incrementView', () => {
  it('calls upsert on brand_analytics with views increment', async () => {
    const client = makeSupabaseClient()
    await incrementView('brand-1')
    expect(client.from).toHaveBeenCalledWith('brand_analytics')
    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ brand_id: 'brand-1', views: 1 }),
      expect.objectContaining({ onConflict: 'brand_id,date' })
    )
  })

  it('does not throw on supabase error', async () => {
    makeSupabaseClient(null, { message: 'DB error' })
    await expect(incrementView('brand-1')).resolves.not.toThrow()
  })
})

describe('incrementClick', () => {
  it('calls upsert on brand_analytics with clicks increment', async () => {
    const client = makeSupabaseClient()
    await incrementClick('brand-1')
    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ brand_id: 'brand-1', clicks: 1 }),
      expect.anything()
    )
  })
})

describe('getAnalytics', () => {
  it('returns totals and trend data for 30 days', async () => {
    const rows = [
      { date: '2026-05-01', views: 10, clicks: 2 },
      { date: '2026-05-15', views: 20, clicks: 5 },
    ]
    makeSupabaseClient(rows)
    const result = await getAnalytics('brand-1', 30)
    expect(result.totalViews).toBe(30)
    expect(result.totalClicks).toBe(7)
  })

  it('returns zeros when no data exists', async () => {
    makeSupabaseClient([])
    const result = await getAnalytics('brand-1', 30)
    expect(result.totalViews).toBe(0)
    expect(result.totalClicks).toBe(0)
    expect(result.viewTrend).toBe('flat')
    expect(result.clickTrend).toBe('flat')
  })
})
