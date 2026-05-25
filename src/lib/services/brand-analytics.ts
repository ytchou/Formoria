import { createServiceClient } from '@/lib/supabase/server'

type Trend = 'up' | 'down' | 'flat'

export type AnalyticsResult = {
  totalViews: number
  totalClicks: number
  viewTrend: Trend
  clickTrend: Trend
}

export async function incrementView(brandId: string): Promise<void> {
  try {
    const client = createServiceClient()
    await client.rpc('increment_brand_view', { p_brand_id: brandId })
  } catch {
    // silent failure — analytics are non-critical
  }
}

export async function incrementClick(brandId: string): Promise<void> {
  try {
    const client = createServiceClient()
    await client.rpc('increment_brand_click', { p_brand_id: brandId })
  } catch {
    // silent failure — analytics are non-critical
  }
}

export async function getAnalytics(brandId: string, days = 30): Promise<AnalyticsResult> {
  try {
    const client = createServiceClient()
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days * 2)
    const since = sinceDate.toISOString().split('T')[0]

    const { data, error } = await client
      .from('brand_analytics')
      .select('date, views, clicks')
      .eq('brand_id', brandId)
      .gte('date', since)

    if (error || !data || data.length === 0) {
      return { totalViews: 0, totalClicks: 0, viewTrend: 'flat', clickTrend: 'flat' }
    }

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    let currentViews = 0
    let currentClicks = 0
    let priorViews = 0
    let priorClicks = 0

    for (const row of data) {
      if (row.date >= cutoffStr) {
        currentViews += row.views
        currentClicks += row.clicks
      } else {
        priorViews += row.views
        priorClicks += row.clicks
      }
    }

    function calcTrend(current: number, prior: number): Trend {
      if (prior === 0) return current > 0 ? 'up' : 'flat'
      if (current > prior * 1.05) return 'up'
      if (current < prior * 0.95) return 'down'
      return 'flat'
    }

    return {
      totalViews: currentViews,
      totalClicks: currentClicks,
      viewTrend: calcTrend(currentViews, priorViews),
      clickTrend: calcTrend(currentClicks, priorClicks),
    }
  } catch {
    return { totalViews: 0, totalClicks: 0, viewTrend: 'flat', clickTrend: 'flat' }
  }
}
