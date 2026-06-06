import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { incrementView, incrementClick, getAnalytics, getSourceBreakdown } from '../brand-analytics'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'

function makeSupabaseClient(data: unknown = null, error: unknown = null) {
  const chain = {
    rpc: vi.fn().mockResolvedValue({ error }),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ data, error }),
  }
  ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(chain)
  return chain
}

describe('incrementView', () => {
  it('calls rpc increment_brand_view with the brand id', async () => {
    const client = makeSupabaseClient()
    await incrementView('brand-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_view', {
      p_brand_id: 'brand-1',
      p_source: 'direct',
    })
  })

  it('passes p_source to the increment_brand_view RPC', async () => {
    const client = makeSupabaseClient()
    await incrementView('brand-1', 'category')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_view', {
      p_brand_id: 'brand-1',
      p_source: 'category',
    })
  })

  it('defaults source to direct when omitted', async () => {
    const client = makeSupabaseClient()
    await incrementView('brand-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_view', {
      p_brand_id: 'brand-1',
      p_source: 'direct',
    })
  })

  it('does not throw on supabase error', async () => {
    makeSupabaseClient(null, { message: 'DB error' })
    await expect(incrementView('brand-1')).resolves.not.toThrow()
  })
})

describe('incrementClick', () => {
  it('calls rpc increment_brand_click with the brand id', async () => {
    const client = makeSupabaseClient()
    await incrementClick('brand-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_click', { p_brand_id: 'brand-1' })
  })
})

describe('getAnalytics', () => {
  // Freeze the clock so the fixed row dates below stay inside the 30-day
  // window regardless of when the suite runs (otherwise the test is a
  // time-bomb that fails once today is >30 days past the row dates).
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

describe('getSourceBreakdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aggregates views by source, sorted desc, excluding zero', async () => {
    const rows = [
      { source: 'direct', views: 10 },
      { source: 'direct', views: 5 },
      { source: 'external_search', views: 20 },
      { source: 'social', views: 0 },
    ]
    makeSupabaseClient(rows)

    const result = await getSourceBreakdown('brand-1', 30)

    expect(result).toEqual([
      { source: 'external_search', views: 20 },
      { source: 'direct', views: 15 },
    ])
  })

  it('returns [] on db error', async () => {
    makeSupabaseClient(null, { message: 'DB error' })
    expect(await getSourceBreakdown('brand-1', 30)).toEqual([])
  })
})
