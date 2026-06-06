import { createServiceClient } from '@/lib/supabase/server'

type Trend = 'up' | 'down' | 'flat'
type AnalyticsClient = ReturnType<typeof createServiceClient> & {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        gte: (column: string, value: string) => {
          order: (
            column: string,
            options?: { ascending?: boolean }
          ) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>
        }
        order: (
          column: string,
          options?: { ascending?: boolean }
        ) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>
      }
    }
  }
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ error: unknown }>
}

export type AnalyticsResult = {
  totalViews: number
  totalClicks: number
  viewTrend: Trend
  clickTrend: Trend
}

export type DailyPoint = {
  date: string
  views: number
  clicks: number
}

export type LinkBreakdownPoint = {
  destination: string
  clicks: number
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return formatLocalDate(date)
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

export async function incrementLinkClick(brandId: string, destination: string): Promise<void> {
  try {
    const client = createServiceClient() as unknown as AnalyticsClient
    await client.rpc('increment_brand_link_click', {
      p_brand_id: brandId,
      p_destination: destination,
    })
  } catch {
    // silent failure — analytics are non-critical
  }
}

export async function getDailySeries(brandId: string, days = 90): Promise<DailyPoint[]> {
  try {
    const client = createServiceClient() as unknown as AnalyticsClient
    const since = getDaysAgo(days - 1)
    const { data, error } = await client
      .from('brand_analytics')
      .select('date, views, clicks')
      .eq('brand_id', brandId)
      .gte('date', since)
      .order('date', { ascending: true })

    if (error) {
      return []
    }

    const pointsByDate = new Map<string, DailyPoint>()

    for (const row of data ?? []) {
      const date = String(row.date)
      pointsByDate.set(date, {
        date,
        views: Number(row.views ?? 0),
        clicks: Number(row.clicks ?? 0),
      })
    }

    const series: DailyPoint[] = []

    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo -= 1) {
      const date = getDaysAgo(daysAgo)
      series.push(pointsByDate.get(date) ?? { date, views: 0, clicks: 0 })
    }

    return series
  } catch {
    return []
  }
}

export async function getLinkClickBreakdown(
  brandId: string,
  days = 90
): Promise<LinkBreakdownPoint[]> {
  try {
    const client = createServiceClient() as unknown as AnalyticsClient
    const since = getDaysAgo(days - 1)
    const { data, error } = await client
      .from('brand_link_clicks')
      .select('destination, clicks')
      .eq('brand_id', brandId)
      .gte('date', since)
      .order('date', { ascending: true })

    if (error) {
      return []
    }

    const clicksByDestination = new Map<string, number>()

    for (const row of data ?? []) {
      const destination = String(row.destination)
      const clicks = Number(row.clicks ?? 0)
      clicksByDestination.set(destination, (clicksByDestination.get(destination) ?? 0) + clicks)
    }

    return Array.from(clicksByDestination.entries())
      .map(([destination, clicks]) => ({ destination, clicks }))
      .sort((left, right) => right.clicks - left.clicks)
  } catch {
    return []
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
